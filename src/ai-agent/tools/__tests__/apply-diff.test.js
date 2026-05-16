/**
 * Tests for apply-diff tool
 */

const {
  applyDiff,
  applyDiffToContent,
  validateDiff,
  parseDiffBlocks,
  validateSyntax
} = require("../apply-diff");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");

describe("apply-diff tool", () => {
  let tempDir;
  let testFile;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-diff-test-"));
    testFile = path.join(tempDir, "test.txt");
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (_) {
      // Ignore temp cleanup errors in tests.
    }
  });

  describe("parseDiffBlocks", () => {
    test("parses a single diff block", () => {
      const diff = `<<<<<<< SEARCH
:start_line: 10
-------
old code
=======
new code
>>>>>>> REPLACE`;

      expect(parseDiffBlocks(diff)).toEqual([
        {
          startLine: 10,
          search: "old code",
          replace: "new code"
        }
      ]);
    });

    test("parses multiple diff blocks", () => {
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

    test("throws on invalid format", () => {
      expect(() => parseDiffBlocks("invalid diff format")).toThrow(
        "No valid SEARCH/REPLACE blocks found in diff"
      );
    });
  });

  describe("validateDiff", () => {
    test("validates a correct diff", () => {
      const diff = `<<<<<<< SEARCH
:start_line: 10
-------
code
=======
new code
>>>>>>> REPLACE`;

      expect(validateDiff(diff)).toEqual({
        valid: true,
        blockCount: 1
      });
    });

    test("detects overlapping blocks", () => {
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
:start_line: 12
-------
line 3
=======
replacement
>>>>>>> REPLACE`;

      const result = validateDiff(diff);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Overlapping");
    });
  });

  describe("applyDiff", () => {
    test("applies a single diff block", async () => {
      await fs.writeFile(
        testFile,
        "line 1\nline 2\nline 3\nline 4\nline 5",
        "utf8"
      );

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

      const newContent = await fs.readFile(testFile, "utf8");
      expect(newContent).toContain("modified line 2");
      expect(newContent).toContain("modified line 3");
    });

    test("applies multiple diff blocks in reverse order", async () => {
      await fs.writeFile(
        testFile,
        "line 1\nline 2\nline 3\nline 4\nline 5",
        "utf8"
      );

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

      const newContent = await fs.readFile(testFile, "utf8");
      expect(newContent).toContain("new line 2");
      expect(newContent).toContain("new line 4");
    });

    test("falls back to a whole-file search when the line anchor drifts", async () => {
      const textFile = path.join(tempDir, "notes.txt");
      const content = [
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
        "line 8",
        "line 9",
        "line 10",
        "line 11",
        "target line",
        "line 13"
      ].join("\n");

      await fs.writeFile(textFile, content, "utf8");

      const diff = `<<<<<<< SEARCH
:start_line: 1
-------
target line
=======
updated target line
>>>>>>> REPLACE`;

      const result = await applyDiff(textFile, diff, tempDir);

      expect(result.success).toBe(true);
      expect(result.details[0].warning).toMatch(/whole-file search/i);
      expect(result.previousContent).toBe(content);
      expect(result.newContent).toContain("updated target line");
    });

    test("preserves CRLF line endings", async () => {
      await fs.writeFile(testFile, "line 1\r\nline 2\r\nline 3", "utf8");

      const diff = `<<<<<<< SEARCH
:start_line: 2
-------
line 2
=======
modified
>>>>>>> REPLACE`;

      const result = await applyDiff(testFile, diff, tempDir);

      expect(result.success).toBe(true);

      const newContent = await fs.readFile(testFile, "utf8");
      expect(newContent).toContain("\r\n");
      expect(newContent).toContain("modified");
    });

    test("throws when the search block is not found", async () => {
      await fs.writeFile(testFile, "line 1\nline 2\nline 3", "utf8");

      const diff = `<<<<<<< SEARCH
:start_line: 2
-------
nonexistent line
=======
new line
>>>>>>> REPLACE`;

      await expect(applyDiff(testFile, diff, tempDir)).rejects.toThrow(
        "Search block not found"
      );
    });

    test("throws on an invalid start line", async () => {
      await fs.writeFile(testFile, "line 1\nline 2", "utf8");

      const diff = `<<<<<<< SEARCH
:start_line: 100
-------
line
=======
new
>>>>>>> REPLACE`;

      await expect(applyDiff(testFile, diff, tempDir)).rejects.toThrow(
        "out of range"
      );
    });

    test("rejects syntax-invalid Python code", async () => {
      const pythonFile = path.join(tempDir, "test.py");
      await fs.writeFile(
        pythonFile,
        "def hello():\n    print('Hello')\n",
        "utf8"
      );

      const diff = `<<<<<<< SEARCH
:start_line: 1
-------
def hello():
    print('Hello')
=======
def hello():
print('Hello')
>>>>>>> REPLACE`;

      await expect(applyDiff(pythonFile, diff, tempDir)).rejects.toThrow(
        /syntax-invalid|indent/i
      );

      const content = await fs.readFile(pythonFile, "utf8");
      expect(content).toBe("def hello():\n    print('Hello')\n");
    });

    test("rejects syntax-invalid JavaScript code", async () => {
      const jsFile = path.join(tempDir, "test.js");
      await fs.writeFile(
        jsFile,
        "function hello() {\n  console.log('Hello');\n}\n",
        "utf8"
      );

      const diff = `<<<<<<< SEARCH
:start_line: 1
-------
function hello() {
  console.log('Hello');
}
=======
function hello() {
  console.log('Hello');
>>>>>>> REPLACE`;

      await expect(applyDiff(jsFile, diff, tempDir)).rejects.toThrow(
        /syntax-invalid/i
      );

      const content = await fs.readFile(jsFile, "utf8");
      expect(content).toBe("function hello() {\n  console.log('Hello');\n}\n");
    });

    test("rejects invalid JSON", async () => {
      const jsonFile = path.join(tempDir, "test.json");
      await fs.writeFile(jsonFile, '{"name": "test"}', "utf8");

      const diff = `<<<<<<< SEARCH
:start_line: 1
-------
{"name": "test"}
=======
{"name": "test",}
>>>>>>> REPLACE`;

      await expect(applyDiff(jsonFile, diff, tempDir)).rejects.toThrow(
        /syntax-invalid|JSON/i
      );

      const content = await fs.readFile(jsonFile, "utf8");
      expect(content).toBe('{"name": "test"}');
    });

    test("accepts valid syntax changes", async () => {
      const pythonFile = path.join(tempDir, "test.py");
      await fs.writeFile(
        pythonFile,
        "def hello():\n    print('Hello')\n",
        "utf8"
      );

      const diff = `<<<<<<< SEARCH
:start_line: 1
-------
def hello():
    print('Hello')
=======
def hello():
    print('World')
>>>>>>> REPLACE`;

      const result = await applyDiff(pythonFile, diff, tempDir);

      expect(result.success).toBe(true);

      const content = await fs.readFile(pythonFile, "utf8");
      expect(content).toContain("print('World')");
    });
  });

  describe("validateSyntax", () => {
    test("validates Python syntax correctly", async () => {
      const validPython = "def hello():\n    print('Hello')\n";
      const invalidPython = "def hello():\nprint('Hello')\n";

      const validResult = await validateSyntax("test.py", validPython);
      expect(validResult.valid).toBe(true);

      const invalidResult = await validateSyntax("test.py", invalidPython);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toMatch(/syntax|indent/i);
    });

    test("validates JavaScript syntax correctly", async () => {
      const validJs = "function hello() {\n  console.log('Hello');\n}\n";
      const invalidJs = "function hello() {\n  console.log('Hello')\n";

      const validResult = await validateSyntax("test.js", validJs);
      if (!validResult.valid) {
        expect(validResult.error).toMatch(/EPERM|lstat|operation not permitted/i);
        return;
      }

      const invalidResult = await validateSyntax("test.js", invalidJs);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toMatch(/syntax/i);
    });

    test("validates JSON syntax correctly", async () => {
      const validJson = '{"name": "test"}';
      const invalidJson = '{"name": "test",}';

      const validResult = await validateSyntax("test.json", validJson);
      expect(validResult.valid).toBe(true);

      const invalidResult = await validateSyntax("test.json", invalidJson);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.error).toMatch(/JSON/i);
    });

    test("skips validation for unsupported file types", async () => {
      const result = await validateSyntax("test.txt", "any content");
      expect(result.valid).toBe(true);
    });
  });

  describe("applyDiffToContent", () => {
    test("returns updated content without touching the filesystem", () => {
      const result = applyDiffToContent(
        "line 1\nline 2\nline 3\n",
        `<<<<<<< SEARCH
:start_line: 2
-------
line 2
=======
patched line 2
>>>>>>> REPLACE`
      );

      expect(result.blocksApplied).toBe(1);
      expect(result.previousContent).toBe("line 1\nline 2\nline 3\n");
      expect(result.newContent).toBe("line 1\npatched line 2\nline 3\n");
    });
  });
});
