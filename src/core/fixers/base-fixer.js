// src/core/fixers/base-fixer.js

class BaseFixer {
  /**
   * @param {string} code - Original code text
   * @param {string} filePath - File path of the code
   */
  constructor(code, filePath) {
    this.code = code;
    this.filePath = filePath;
    this.fixes = [];
  }

  /**
   * Add a fix for a specific range
   * @param {number} start - Start index in code
   * @param {number} end - End index in code
   * @param {string} text - Replacement text
   */
  addFix(start, end, text) {
    this.fixes.push({ range: [start, end], text });
  }

  /**
   * Apply all recorded fixes and return the resulting code
   * @returns {string} - Code after applying fixes
   */
  applyFixes() {
    let newCode = this.code;

    // Apply fixes in reverse order so indices don't get messed up
    for (let i = this.fixes.length - 1; i >= 0; i--) {
      const { range, text } = this.fixes[i];
      newCode = newCode.slice(0, range[0]) + text + newCode.slice(range[1]);
    }

    return newCode;
  }

  /**
   * Optional placeholder for analyzing/fixing code.
   * Each specific fixer should override this method.
   */
  async analyze() {
    throw new Error("analyze() not implemented in BaseFixer");
  }
}

module.exports = BaseFixer;
