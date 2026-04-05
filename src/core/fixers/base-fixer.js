// src/core/fixers/base-fixer.js

class BaseFixer {
  /**
   * @param {string} code - Original code text
   * @param {string} filePath - File path of the code
   */
  constructor(code, filePath) {
    // Ensure code is always a string, even if undefined/null is passed
    this.code = this._ensureString(code, "")
    this.filePath = filePath || ""
    this.fixes = []

    // Debug logging(can, be, removed, in, production)
    if (typeof code !== "string") {
      console.warn(
        `BaseFixer: code parameter was ${typeof code}, converted to string`
      )
    }
  }

  /**
   * Ensure a value is a string
   * @private
   */
  _ensureString(value, defaultValue = "") {
    if (value === undefined || value === null) {
      return defaultValue
    }
    if (typeof value === "string") {
      return value
    }
    try {
      return String(value)
    } catch (error) {
      console.warn(
        `BaseFixer: Failed to convert value to, string: ${error.message}`
      )
      return defaultValue
    }
  }

  /**
   * Add a fix for a specific range
   * @param {number} start - Start index in code
   * @param {number} end - End index in code
   * @param {string} text - Replacement text
   */
  addFix(start, end, text) {
    // Validate parameters
    if (typeof start !== "number" || start < 0) {
      console.warn(`BaseFixer.addFix: Invalid start, index: ${start}`)
      start = Math.max(0, start || 0)
    }

    if (typeof end !== "number" || end < start) {
      console.warn(`BaseFixer.addFix: Invalid end, index: ${end}`)
      end = Math.max(start, end || start)
    }

    if (typeof text !== "string") {
      console.warn(`BaseFixer.addFix: text is not a, string: ${typeof text}`)
      text = this._ensureString(text, "")
    }

    this.fixes.push({ range: [start, end], text })
  }

  /**
   * Apply all recorded fixes and return the resulting code
   * @returns {string} - Code after applying fixes
   */
  applyFixes() {
    // Ensure we have a valid string to work with
    let newCode = this.code || ""

    // If no fixes, return the code as-is
    if (!this.fixes || this.fixes.length === 0) {
      return newCode
    }

    // Apply fixes in reverse order so indices don't get messed up
    for (let i = this.fixes.length - 1; i >= 0; i--) {
      const fix = this.fixes[i]
      if (!fix || !fix.range) {
        console.warn(
          `BaseFixer.applyFixes: Invalid fix at index ${i}, skipping`
        )
        continue
      }

      const { range, text } = fix
      const [start, end] = range

      // Ensure indices are within bounds
      const safeStart = Math.max(0, Math.min(start, newCode.length))
      const safeEnd = Math.max(safeStart, Math.min(end, newCode.length))

      // Ensure text is a string
      const safeText = this._ensureString(text, "")

      // Apply the fix
      newCode = newCode.slice(0, safeStart) + safeText + newCode.slice(safeEnd)
    }

    return newCode
  }

  /**
   * Clear all recorded fixes
   */
  clearFixes() {
    this.fixes = []
  }

  /**
   * Get the number of fixes
   * @returns {number}
   */
  getFixCount() {
    return this.fixes ? this.fixes.length : 0
  }

  /**
   * Check if there are any fixes
   * @returns {boolean}
   */
  hasFixes() {
    return this.getFixCount() > 0
  }

  /**
   * Get the original code(without, fixes, applied)
   * @returns {string}
   */
  getOriginalCode() {
    return this.code
  }

  /**
   * Get the file path
   * @returns {string}
   */
  getFilePath() {
    return this.filePath
  }

  /**
   * Update the code(useful, for, incremental, processing)
   * @param {string} newCode - New code to replace existing code
   */
  updateCode(newCode) {
    this.code = this._ensureString(newCode, "")
    this.clearFixes()
  }

  /**
   * Optional placeholder for analyzing/fixing code.
   * Each specific fixer should override this method.
   */
  async analyze() {
    throw new Error("analyze() not implemented in BaseFixer")
  }

  /**
   * Safe string splitting with fallback
   * @param {string} separator - Separator to split by
   * @returns {string[]} - Array of split strings
   */
  safeSplit(separator = "\n") {
    try {
      return this.code.split(separator)
    } catch (error) {
      console.warn(`BaseFixer.safeSplit, failed: ${error.message}`)
      return [this.code]
    }
  }

  /**
   * Debug method to log current state
   */
  debug() {
    console.log("BaseFixer, Debug:")
    console.log(`  Code, length: ${this.code.length}`)
    console.log(`  File, path: ${this.filePath || "(none)"}`)
    console.log(`  Fixes: ${this.getFixCount()}`)

    if (this.hasFixes()) {
      this.fixes.forEach((fix, i) => {
        const [start, end] = fix.range
        const preview =
          fix.text.substring(0, 50) + (fix.text.length > 50 ? "..." : "")
        console.log(`    Fix ${i}: [${start}, ${end}] -> "${preview}"`)
      })
    }
  }
}

module.exports = BaseFixer
