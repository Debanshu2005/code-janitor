const fs = require("fs")
const path = require("path")

class FrontendValidator {
  constructor(filePath, code) {
    this.filePath = filePath
    this.code = code
    this.workspaceRoot = this._getWorkspaceRoot()
    this.issues = []
  }

  _getWorkspaceRoot() {
    let dir = path.dirname(this.filePath)
    while (dir !== path.dirname(dir)) {
      if (
        fs.existsSync(path.join(dir, "package.json")) ||
        fs.existsSync(path.join(dir, "index.html"))
      ) {
        return dir
      }
      dir = path.dirname(dir)
    }
    return path.dirname(this.filePath)
  }

  validate() {
    const ext = path.extname(this.filePath).toLowerCase()

    switch (ext) {
      case ".html":
        this._validateHTML()
        break
      case ".css":
        this._validateCSS()
        break
      case ".js":
        this._validateJS()
        break
    }

    return {
      hasIssues: this.issues.length > 0,
      issues: this.issues,
      fixedCode: this._applyFixes()
    }
  }

  _validateHTML() {
    // Check for missing CSS files
    const cssLinks =
      this.code.match(/<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi) || []
    cssLinks.forEach((link) => {
      const href = link.match(/href=["']([^"']+)["']/i)?.[1]
      if (href && !this._fileExists(href)) {
        this.issues.push({
          type: "missing-file",
          file: href,
          line: this._getLineNumber(link),
          message: `CSS file not found: ${href}`
        })
      }
    })

    // Check for missing JS files
    const jsScripts =
      this.code.match(/<script[^>]*src=["']([^"']+\.js)["'][^>]*>/gi) || []
    jsScripts.forEach((script) => {
      const src = script.match(/src=["']([^"']+)["']/i)?.[1]
      if (src && !this._fileExists(src)) {
        this.issues.push({
          type: "missing-file",
          file: src,
          line: this._getLineNumber(script),
          message: `JavaScript file not found: ${src}`
        })
      }
    })

    // Check for missing images
    const images =
      this.code.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi) || []
    images.forEach((img) => {
      const src = img.match(/src=["']([^"']+)["']/i)?.[1]
      if (src && !src.startsWith("http") && !this._fileExists(src)) {
        this.issues.push({
          type: "missing-file",
          file: src,
          line: this._getLineNumber(img),
          message: `Image file not found: ${src}`
        })
      }
    })
  }

  _validateCSS() {
    // Check for missing @import files
    const imports = this.code.match(/@import\s+["']([^"']+)["']/gi) || []
    imports.forEach((imp) => {
      const file = imp.match(/["']([^"']+)["']/)?.[1]
      if (file && !this._fileExists(file)) {
        this.issues.push({
          type: "missing-file",
          file: file,
          line: this._getLineNumber(imp),
          message: `CSS import not found: ${file}`
        })
      }
    })

    // Check for missing background images
    const bgImages = this.code.match(/url\(["']?([^"')]+)["']?\)/gi) || []
    bgImages.forEach((bg) => {
      const file = bg.match(/url\(["']?([^"')]+)["']?\)/i)?.[1]
      if (file && !file.startsWith("http") && !this._fileExists(file)) {
        this.issues.push({
          type: "missing-file",
          file: file,
          line: this._getLineNumber(bg),
          message: `Background image not found: ${file}`
        })
      }
    })
  }

  _validateJS() {
    // Check for missing module imports (ES6)
    const imports =
      this.code.match(/import\s+.*\s+from\s+["']([^"']+)["']/gi) || []
    imports.forEach((imp) => {
      const file = imp.match(/from\s+["']([^"']+)["']/i)?.[1]
      if (file && file.startsWith("./") && !this._fileExists(file)) {
        this.issues.push({
          type: "missing-file",
          file: file,
          line: this._getLineNumber(imp),
          message: `Module not found: ${file}`
        })
      }
    })
  }

  _fileExists(relativePath) {
    if (relativePath.startsWith("http")) return true

    const fullPath = path.resolve(path.dirname(this.filePath), relativePath)
    return (
      fs.existsSync(fullPath) ||
      fs.existsSync(fullPath + ".js") ||
      fs.existsSync(fullPath + ".css")
    )
  }

  _getLineNumber(text) {
    const beforeText = this.code.substring(0, this.code.indexOf(text))
    return beforeText.split("\n").length
  }

  _applyFixes() {
    let fixedCode = this.code

    // Auto-create missing CSS/JS file references
    this.issues.forEach((issue) => {
      if (
        issue.type === "missing-file" &&
        (issue.file.endsWith(".css") || issue.file.endsWith(".js"))
      ) {
        const fullPath = path.resolve(path.dirname(this.filePath), issue.file)
        const dir = path.dirname(fullPath)

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        if (!fs.existsSync(fullPath)) {
          const content = issue.file.endsWith(".css")
            ? "/* Auto-generated CSS file */\n"
            : "// Auto-generated JS file\n"
          fs.writeFileSync(fullPath, content)
        }
      }
    })

    return fixedCode
  }
}

module.exports = FrontendValidator
