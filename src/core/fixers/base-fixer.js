/**
 * Abstract base class for all language-specific fixers
 */
class BaseFixer {
  constructor(code, filePath) {
    this.code = code;
    this.filePath = filePath;
    this.fixes = []; // Array of { range: [start, end], text: string }
    this.lines = code.split('\n');
  }

  /**
   * Analyze the code and populate the fixes array
   * Must be implemented by subclasses
   */
  async analyze() {
    throw new Error('Analyze method must be implemented by subclass');
  }

  /**
   * Apply all fixes to the code
   * @returns {string} - The fixed code
   */
  applyFixes() {
    if (this.fixes.length === 0) {
      return this.code;
    }

    // Sort fixes from end to beginning to avoid position conflicts
    const sortedFixes = [...this.fixes].sort((a, b) => b.range[0] - a.range[0]);
    
    let modifiedCode = this.code;
    for (const fix of sortedFixes) {
      const before = modifiedCode.substring(0, fix.range[0]);
      const after = modifiedCode.substring(fix.range[1]);
      modifiedCode = before + fix.text + after;
    }
    
    return modifiedCode;
  }

  /**
   * Add a fix to be applied
   * @param {number} start - Start index in the original code
   * @param {number} end - End index in the original code
   * @param {string} text - Text to insert
   */
  addFix(start, end, text) {
    this.fixes.push({ range: [start, end], text });
  }

  /**
   * Helper to get the text between two positions
   */
  getText(start, end) {
    return this.code.substring(start, end);
  }

  /**
   * Helper to convert line/column to absolute position
   */
  getPosition(line, column) {
    let position = 0;
    for (let i = 0; i < line; i++) {
      position += this.lines[i].length + 1; // +1 for newline
    }
    return position + column;
  }

  /**
   * Helper to get line start and end positions
   */
  getLineRange(lineNumber) {
    let start = 0;
    for (let i = 0; i < lineNumber; i++) {
      start += this.lines[i].length + 1;
    }
    const end = start + this.lines[lineNumber].length;
    return { start, end };
  }
}

module.exports = BaseFixer;