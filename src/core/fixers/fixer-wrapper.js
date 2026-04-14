// src/core/fixers/fixer-wrapper.js
const PythonFixer = require("./python-fixer")
const JavaScriptFixer = require("./javascript-fixer")
const EmbeddedCFixer = require("./EmbeddedCFixer")
const JavaFixer = require("./JavaFixer")
const HtmlFixer = require("./html-fixer")
const OllamaClient = require("../ai/ollama-client")

const ollamaClient = new OllamaClient()

function getRawFixerOutput(fixer, result, originalCode) {
  if (result && typeof result.fixedCode === "string") {
    return result.fixedCode
  }

  if (result && typeof result.formatted === "string") {
    return result.formatted
  }

  if (fixer && typeof fixer.fixedCode === "string") {
    return fixer.fixedCode
  }

  if (fixer && typeof fixer.applyFixes === "function") {
    return fixer.applyFixes()
  }

  return originalCode
}

async function fixPythonBuffer(code, filePath = "") {
  try {
    const fixer = new PythonFixer(code, filePath)
    const result = await fixer.analyze()
    let fixedCode = getRawFixerOutput(fixer, result, code)

    // AI validation and enhancement if enabled
    if (await ollamaClient.isAvailable()) {
      const force =
        !ollamaClient._passesLanguageValidation(code, "python") ||
        !ollamaClient._passesLanguageValidation(fixedCode, "python")
      const aiResult = await ollamaClient.validateAndFix(
        code,
        fixedCode,
        "python",
        { force }
      )
      if (aiResult && aiResult.shouldUseAI) {
        console.log(`AI improved code: ${aiResult.reason}`)
        fixedCode = aiResult.fixedCode
      } else if (aiResult && !aiResult.shouldUseAI) {
        console.log(`Using rule-based fixes: ${aiResult.reason}`)
      }
    }

    return fixedCode
  } catch (error) {
    console.error("Python fixer error:", error)
    return code
  }
}

async function fixJSBuffer(code, filePath = "") {
  try {
    const fixer = new JavaScriptFixer(code, filePath)
    const result = await fixer.analyze()
    let fixedCode = getRawFixerOutput(fixer, result, code)

    // AI validation and enhancement if enabled
    if (await ollamaClient.isAvailable()) {
      const force =
        !ollamaClient._passesLanguageValidation(code, "javascript") ||
        !ollamaClient._passesLanguageValidation(fixedCode, "javascript")
      const aiResult = await ollamaClient.validateAndFix(
        code,
        fixedCode,
        "javascript",
        { force }
      )
      if (aiResult && aiResult.shouldUseAI) {
        console.log(`AI improved code: ${aiResult.reason}`)
        fixedCode = aiResult.fixedCode
      } else if (aiResult && !aiResult.shouldUseAI) {
        console.log(`Using rule-based fixes: ${aiResult.reason}`)
      }
    }

    return fixedCode
  } catch (error) {
    console.error("JavaScript fixer error:", error)
    return code
  }
}

async function fixEmbeddedCBuffer(code, filePath = "") {
  try {
    const fixer = new EmbeddedCFixer(code, filePath)
    const result = await fixer.analyze()
    return getRawFixerOutput(fixer, result, code)
  } catch (error) {
    console.error("Embedded C fixer error:", error)
    return code
  }
}

async function fixJavaBuffer(code, filePath = "") {
  try {
    const fixer = new JavaFixer(code, filePath)
    const result = await fixer.analyze()
    return getRawFixerOutput(fixer, result, code)
  } catch (error) {
    console.error("Java fixer error:", error)
    return code
  }
}

async function fixHtmlBuffer(code, filePath = "") {
  try {
    const fixer = new HtmlFixer(code, filePath)
    const result = await fixer.analyze()
    return getRawFixerOutput(fixer, result, code)
  } catch (error) {
    console.error("HTML fixer error:", error)
    return code
  }
}

// Unified fixer function that detects language and routes appropriately
async function fixCodeBuffer(code, filePath = "", language = "") {
  const lang =
    language || detectLanguageFromPath(filePath) || detectLanguageFromCode(code)

  console.log(`🔧 Fixing code (${lang}) for: ${filePath || "buffer"}`)

  switch (lang.toLowerCase()) {
    case "python":
    case "py":
      return await fixPythonBuffer(code, filePath)

    case "javascript":
    case "js":
    case "typescript":
    case "ts":
      return await fixJSBuffer(code, filePath)

    case "c":
    case "cpp":
    case "c++":
    case "embedded-c":
      return await fixEmbeddedCBuffer(code, filePath)

    case "java":
      return await fixJavaBuffer(code, filePath)

    case "html":
    case "htm":
      return await fixHtmlBuffer(code, filePath)

    default:
      console.warn(`No fixer available for language: ${lang}`)
      return code
  }
}

// Helper functions
function detectLanguageFromPath(filePath) {
  if (!filePath) return ""

  const ext = filePath.split(".").pop().toLowerCase()
  const extensionMap = {
    py: "python",
    js: "javascript",
    ts: "typescript",
    c: "c",
    cpp: "cpp",
    h: "c",
    java: "java",
    html: "html",
    htm: "html"
  }

  return extensionMap[ext] || ""
}

function detectLanguageFromCode(code) {
  const firstLine = code.trim().split("\n")[0]

  if (
    firstLine.includes("#!/usr/bin/env python") ||
    firstLine.includes("#!/usr/bin/python")
  ) {
    return "python"
  }
  if (firstLine.includes("<html") || code.includes("</html>")) {
    return "html"
  }
  if (code.includes("public class") || code.includes("import java.")) {
    return "java"
  }
  if (code.includes("#include") || code.includes("int main(")) {
    return "c"
  }

  return ""
}

// Export all functions
module.exports = {
  fixPythonBuffer,
  fixJSBuffer,
  fixEmbeddedCBuffer,
  fixJavaBuffer,
  fixHtmlBuffer,
  fixCodeBuffer, // Unified interface
  detectLanguageFromPath,
  detectLanguageFromCode
}
