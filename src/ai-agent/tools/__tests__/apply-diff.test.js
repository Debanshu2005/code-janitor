/**
 * Tests for apply-diff tool
 */

const { applyDiff, validateDiff, parseDiffBlocks } = require('../apply-diff');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('apply-diff tool', () => {
  let tempDir;
  let testFile;
  
  beforeEach(async () => {
    // Create temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-diff-test-'));
    testFile = path.join(tempDir, 'test.js');
  });
  
  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });
  
  describe('parseDiffBlocks', () => {
    test('parses single diff block', () => {
      const diff = `<<<<<<< SEARCH
:start_line: 10
-------
old code
=======
new code
>>>>>>> REPLACE`;
      
      const blocks = parseDiffBlocks(diff);
      
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        startLine: 10,
        search: 'old code',
        replace: 'new code'
      });
    });
    
    test('parses multiple diff blocks', () => {
      const diff = `<<<<<<< SEARCH
:start_line: 5
-------
first old
=======
first new
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line: 15
-------
second old
=======
second new
>>>>>>> REPLACE`;
      
      const blocks = parseDiffBlocks(diff);
      
      expect(blocks).toHaveLength(2);
      expect(blocks[0].startLine).toBe(5);
      expect(blocks[1].startLine).toBe(15);
    });
    
    test('throws on invalid format', () => {
      const diff = 'invalid diff format';
      
      expect(() => parseDiffBlocks(diff)).toThrow('No valid SEARCH/REPLACE blocks');
    });
  });
  
  describe('validateDiff', () => {
    test('validates correct diff', () => {
      const diff = `<<<<<<< SEARCH
:start_line: 10
-------
code
=======
new code
>>>>>>> REPLACE`;
      
      const result = validateDiff(diff);
      
      expect(result.valid).toBe(true);
      expect(result.blockCount).toBe(1);
    });
    
    test('detects overlapping blocks', () => {
      const diff = `<<<<<<< SEARCH
:start_line: 10
-------
line 1
line 2
line 3
=======
new lines
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line: 11
-------
overlap
=======
new
>>>>>>> REPLACE`;
      
      const result = validateDiff(diff);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Overlapping');
    });
  });
  
  describe('applyDiff', () => {
    test('applies single diff block', async () => {
      const content = `line 1
line 2
line 3
line 4
line 5`;
      
      await fs.writeFile(testFile, content);
      
      const diff = `<<<<<<< SEARCH
:start_line: 2
-------
line 2
line 3
=======
modified line 2
modified line 3
>>>>>>> REPLACE`;
      
      const result = await applyDiff(testFile, diff, tempDir);
      
      expect(result.success).toBe(true);
      expect(result.blocksApplied).toBe(1);
      
      const newContent = await fs.readFile(testFile, 'utf8');
      expect(newContent).toContain('modified line 2');
      expect(newContent).toContain('modified line 3');
    });
    
    test('applies multiple diff blocks in reverse order', async () => {
      const content = `line 1
line 2
line 3
line 4
line 5`;
      
      await fs.writeFile(testFile, content);
      
      const diff = `<<<<<<< SEARCH
:start_line: 2
-------
line 2
=======
new line 2
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line: 4
-------
line 4
=======
new line 4
>>>>>>> REPLACE`;
      
      const result = await applyDiff(testFile, diff, tempDir);
      
      expect(result.success).toBe(true);
      expect(result.blocksApplied).toBe(2);
      
      const newContent = await fs.readFile(testFile, 'utf8');
      expect(newContent).toContain('new line 2');
      expect(newContent).toContain('new line 4');
    });
    
    test('handles CRLF line endings', async () => {
      const content = 'line 1\r\nline 2\r\nline 3';
      
      await fs.writeFile(testFile, content);
      
      const diff = `<<<<<<< SEARCH
:start_line: 2
-------
line 2
=======
modified
>>>>>>> REPLACE`;
      
      const result = await applyDiff(testFile, diff, tempDir);
      
      expect(result.success).toBe(true);
      
      const newContent = await fs.readFile(testFile, 'utf8');
      expect(newContent).toContain('\r\n'); // CRLF preserved
      expect(newContent).toContain('modified');
    });
    
    test('throws on search not found', async () => {
      const content = 'line 1\nline 2\nline 3';
      
      await fs.writeFile(testFile, content);
      
      const diff = `<<<<<<< SEARCH
:start_line: 2
-------
nonexistent line
=======
new line
>>>>>>> REPLACE`;
      
      await expect(applyDiff(testFile, diff, tempDir)).rejects.toThrow('Search block not found');
    });
    
    test('throws on invalid line number', async () => {
      const content = 'line 1\nline 2';
      
      await fs.writeFile(testFile, content);
      
      const diff = `<<<<<<< SEARCH
:start_line: 100
-------
line
=======
new
>>>>>>> REPLACE`;
      
      await expect(applyDiff(testFile, diff, tempDir)).rejects.toThrow('out of range');
    });
  });
});

// Made with Bob
