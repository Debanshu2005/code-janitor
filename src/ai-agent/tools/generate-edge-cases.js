/**
 * generate-edge-cases.js
 * 
 * Tool for generating edge cases for code testing
 */

const fs = require("fs").promises;
const path = require("path");
const vscode = require("../../utils/vscode-shim");
const { parseFile, getLanguage } = require("./list-code-definition-names");
const { runProviderPrompt } = require("../provider-utils");

/**
 * Edge case categories for different code constructs
 */
const EDGE_CASE_CATEGORIES = {
  // Numeric edge cases
  NUMERIC: {
    name: "Numeric Boundaries",
    cases: [
      { value: 0, description: "Zero value" },
      { value: -1, description: "Negative value" },
      { value: 1, description: "Positive value" },
      { value: Number.MAX_SAFE_INTEGER, description: "Maximum safe integer" },
      { value: Number.MIN_SAFE_INTEGER, description: "Minimum safe integer" },
      { value: Infinity, description: "Infinity" },
      { value: -Infinity, description: "Negative infinity" },
      { value: NaN, description: "Not a number" },
      { value: 0.1 + 0.2, description: "Floating point precision" }
    ]
  },
  
  // String edge cases
  STRING: {
    name: "String Boundaries",
    cases: [
      { value: "", description: "Empty string" },
      { value: " ", description: "Single space" },
      { value: "   ", description: "Multiple spaces" },
      { value: "\n", description: "Newline character" },
      { value: "\t", description: "Tab character" },
      { value: "a".repeat(10000), description: "Very long string" },
      { value: "🚀", description: "Unicode emoji" },
      { value: "null", description: "String 'null'" },
      { value: "undefined", description: "String 'undefined'" },
      { value: "<script>alert('xss')</script>", description: "XSS attempt" },
      { value: "'; DROP TABLE users; --", description: "SQL injection attempt" }
    ]
  },
  
  // Array edge cases
  ARRAY: {
    name: "Array Boundaries",
    cases: [
      { value: [], description: "Empty array" },
      { value: [null], description: "Array with null" },
      { value: [undefined], description: "Array with undefined" },
      { value: [1, 2, 3], description: "Small array" },
      { value: new Array(10000).fill(0), description: "Large array" },
      { value: [[[]]], description: "Nested arrays" },
      { value: [1, "2", null, undefined, {}], description: "Mixed types" }
    ]
  },
  
  // Object edge cases
  OBJECT: {
    name: "Object Boundaries",
    cases: [
      { value: {}, description: "Empty object" },
      { value: null, description: "Null object" },
      { value: { a: undefined }, description: "Object with undefined property" },
      { value: { toString: () => "custom" }, description: "Object with custom toString" },
      { value: Object.create(null), description: "Object without prototype" },
      { value: { nested: { deep: { value: 1 } } }, description: "Deeply nested object" }
    ]
  },
  
  // Boolean edge cases
  BOOLEAN: {
    name: "Boolean Boundaries",
    cases: [
      { value: true, description: "True value" },
      { value: false, description: "False value" },
      { value: 0, description: "Falsy zero" },
      { value: 1, description: "Truthy one" },
      { value: "", description: "Falsy empty string" },
      { value: "false", description: "Truthy string 'false'" }
    ]
  },
  
  // Function edge cases
  FUNCTION: {
    name: "Function Boundaries",
    cases: [
      { description: "Function with no arguments" },
      { description: "Function with too many arguments" },
      { description: "Function with wrong argument types" },
      { description: "Function that throws error" },
      { description: "Async function that rejects" },
      { description: "Recursive function with deep recursion" }
    ]
  },
  
  // Date edge cases
  DATE: {
    name: "Date Boundaries",
    cases: [
      { value: new Date(0), description: "Unix epoch" },
      { value: new Date("invalid"), description: "Invalid date" },
      { value: new Date(8640000000000000), description: "Maximum date" },
      { value: new Date(-8640000000000000), description: "Minimum date" }
    ]
  }
};

function isAiTestingEnabled() {
  return vscode.workspace
    .getConfiguration("codeJanitor.testing.aiAssist")
    .get("enabled", false);
}

function getAiTestingProvider() {
  return String(
    vscode.workspace
      .getConfiguration("codeJanitor.testing.aiAssist")
      .get("provider", "") || ""
  ).trim();
}

function extractJsonPayload(text) {
  const source = String(text || "").trim();
  if (!source) return null;

  const fencedMatch = source.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : source;
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  const payload = objectMatch?.[0] || arrayMatch?.[0] || candidate;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function dedupeEdgeCases(edgeCases = []) {
  const seen = new Set();
  return edgeCases.filter((edgeCase) => {
    const key = JSON.stringify({
      functionName: edgeCase.functionName || "",
      className: edgeCase.className || "",
      methodName: edgeCase.methodName || "",
      parameterName: edgeCase.parameterName || "",
      category: edgeCase.category || "",
      description: edgeCase.testCase?.description || "",
      value: edgeCase.testCase?.value,
      values: edgeCase.testCase?.values
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serializeJavaScriptValue(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
  return JSON.stringify(value);
}

function serializePythonValue(value) {
  if (value === undefined) return "None";
  if (value === null) return "None";
  if (typeof value === "number" && Number.isNaN(value)) return "float('nan')";
  if (value === Infinity) return "float('inf')";
  if (value === -Infinity) return "float('-inf')";
  return JSON.stringify(value);
}

function serializeJavaValue(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value === "number" && Number.isNaN(value)) return "Double.NaN";
  if (value === Infinity) return "Double.POSITIVE_INFINITY";
  if (value === -Infinity) return "Double.NEGATIVE_INFINITY";
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}

function buildInvocationValues(edgeCase, serializer) {
  const { testCase, parameterCount = 0, parameterIndex } = edgeCase || {};

  if (Array.isArray(testCase?.values)) {
    return testCase.values.map((value) => serializer(value));
  }

  if (Object.prototype.hasOwnProperty.call(testCase || {}, "value")) {
    if (Number.isInteger(parameterIndex) && parameterCount > 1) {
      const invocationValues = Array.from(
        { length: parameterCount },
        () => serializer(undefined)
      );
      invocationValues[parameterIndex] = serializer(testCase.value);
      return invocationValues;
    }

    return [serializer(testCase.value)];
  }

  if (parameterCount > 0) {
    return Array.from({ length: parameterCount }, () => serializer(undefined));
  }

  return [];
}

function buildJavaScriptRequirePath(fileName) {
  const normalizedFilePath = String(fileName || "").replace(/\\/g, "/");
  const sourceDirectory = path.posix.dirname(normalizedFilePath);
  const testDirectory = path.posix.join(sourceDirectory, "__tests__");
  let relativeImport = path.posix.relative(testDirectory, normalizedFilePath);
  relativeImport = relativeImport.replace(/\.[^.]+$/, "");

  if (!relativeImport.startsWith(".")) {
    relativeImport = `./${relativeImport}`;
  }

  return relativeImport;
}

async function generateAiEdgeCases(
  filePath,
  workspaceRoot,
  language,
  content,
  definitions,
  heuristicEdgeCases,
  executionContext = {}
) {
  if (!isAiTestingEnabled() || !executionContext?.agent || !executionContext?.context) {
    return { edgeCases: [], notes: [] };
  }

  const result = await runProviderPrompt({
    context: executionContext.context,
    agent: executionContext.agent,
    workspaceRoot,
    preferredProvider: getAiTestingProvider(),
    mode: "fast",
    intent: "general",
    systemOverlay: "Return JSON only. No prose outside JSON.",
    prompt:
      "Suggest additional edge cases for this source file. " +
      "Return JSON with shape {\"notes\": string[], \"edgeCases\": [{\"functionName\": string, \"className\": string, \"methodName\": string, \"parameterName\": string, \"parameterIndex\": number, \"category\": string, \"testCase\": {\"description\": string, \"value\": any, \"values\": any[]}}]}.\n\n" +
      `Language: ${language}\n` +
      `File path: ${filePath}\n` +
      `Definitions: ${JSON.stringify(definitions, null, 2)}\n` +
      `Existing heuristic edge cases summary: ${JSON.stringify(countByCategory(heuristicEdgeCases), null, 2)}\n` +
      `Source excerpt:\n${content.slice(0, 6000)}`
  });

  const payload = extractJsonPayload(result.text);
  const aiEdgeCases = Array.isArray(payload?.edgeCases)
    ? payload.edgeCases
        .filter((edgeCase) => edgeCase && edgeCase.testCase?.description)
        .map((edgeCase) => ({
          functionName: edgeCase.functionName || undefined,
          className: edgeCase.className || undefined,
          methodName: edgeCase.methodName || undefined,
          parameterName: edgeCase.parameterName || undefined,
          parameterIndex:
            Number.isInteger(edgeCase.parameterIndex) ? edgeCase.parameterIndex : undefined,
          category: String(edgeCase.category || "AI_RECOMMENDED").trim() || "AI_RECOMMENDED",
          testCase: {
            description: String(edgeCase.testCase.description || "").trim(),
            ...(Object.prototype.hasOwnProperty.call(edgeCase.testCase, "value")
              ? { value: edgeCase.testCase.value }
              : {}),
            ...(Array.isArray(edgeCase.testCase.values)
              ? { values: edgeCase.testCase.values }
              : {})
          }
        }))
    : [];

  return {
    edgeCases: dedupeEdgeCases(aiEdgeCases),
    notes: Array.isArray(payload?.notes)
      ? payload.notes.map((note) => String(note || "").trim()).filter(Boolean)
      : []
  };
}

function extractDefinitionsFallback(content, language) {
  const source = String(content || "");
  const definitions = [];

  if (language === "javascript" || language === "typescript") {
    const functionRegex = /function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/g;
    const classRegex = /class\s+([A-Za-z0-9_$]+)/g;
    let match;

    while ((match = functionRegex.exec(source))) {
      definitions.push({
        type: "function",
        name: match[1],
        params: String(match[2] || "")
          .split(",")
          .map((param) => param.trim())
          .filter(Boolean)
          .map((param) => ({ name: param }))
      });
    }

    while ((match = classRegex.exec(source))) {
      definitions.push({
        type: "class",
        name: match[1],
        methods: []
      });
    }
  } else if (language === "python") {
    const functionRegex = /^\s*def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gm;
    const classRegex = /^\s*class\s+([A-Za-z0-9_]+)/gm;
    let match;

    while ((match = functionRegex.exec(source))) {
      definitions.push({
        type: "function",
        name: match[1],
        params: String(match[2] || "")
          .split(",")
          .map((param) => param.trim())
          .filter(Boolean)
          .map((param) => ({ name: param.replace(/=.*/, "").trim() }))
      });
    }

    while ((match = classRegex.exec(source))) {
      definitions.push({
        type: "class",
        name: match[1],
        methods: []
      });
    }
  } else if (language === "java") {
    const classRegex = /class\s+([A-Za-z0-9_]+)/g;
    let match;
    while ((match = classRegex.exec(source))) {
      definitions.push({
        type: "class",
        name: match[1],
        methods: []
      });
    }
  }

  return definitions;
}

/**
 * Generate edge cases for a function based on its parameters
 */
function generateFunctionEdgeCases(functionDef) {
  const edgeCases = [];
  const { name, params = [] } = functionDef;
  
  // Generate test cases for each parameter
  params.forEach((param, index) => {
    const paramName = param.name || `param${index}`;
    const paramType = inferParameterType(param);
    
    // Get relevant edge cases for this parameter type
    const relevantCases = getEdgeCasesForType(paramType);
    
    relevantCases.forEach(edgeCase => {
      edgeCases.push({
        functionName: name,
        parameterIndex: index,
        parameterName: paramName,
        parameterCount: params.length,
        testCase: edgeCase,
        category: paramType
      });
    });
  });
  
  // Add combination edge cases
  if (params.length > 1) {
    edgeCases.push({
      functionName: name,
      parameterCount: params.length,
      testCase: {
        description: "All parameters null",
        values: params.map(() => null)
      },
      category: "COMBINATION"
    });
    
    edgeCases.push({
      functionName: name,
      parameterCount: params.length,
      testCase: {
        description: "All parameters undefined",
        values: params.map(() => undefined)
      },
      category: "COMBINATION"
    });
  }
  
  return edgeCases;
}

/**
 * Infer parameter type from parameter definition
 */
function inferParameterType(param) {
  if (!param) return "OBJECT";
  
  const name = (param.name || "").toLowerCase();
  const type = (param.type || "").toLowerCase();
  
  // Check type annotation
  if (type.includes("number") || type.includes("int") || type.includes("float")) {
    return "NUMERIC";
  }
  if (type.includes("string") || type.includes("str")) {
    return "STRING";
  }
  if (type.includes("array") || type.includes("list")) {
    return "ARRAY";
  }
  if (type.includes("bool")) {
    return "BOOLEAN";
  }
  if (type.includes("date")) {
    return "DATE";
  }
  if (type.includes("function") || type.includes("callback")) {
    return "FUNCTION";
  }
  
  // Check parameter name
  if (name.includes("count") || name.includes("index") || name.includes("num")) {
    return "NUMERIC";
  }
  if (name.includes("name") || name.includes("text") || name.includes("str")) {
    return "STRING";
  }
  if (name.includes("array") || name.includes("list") || name.includes("items")) {
    return "ARRAY";
  }
  if (name.includes("flag") || name.includes("is") || name.includes("has")) {
    return "BOOLEAN";
  }
  
  return "OBJECT";
}

/**
 * Get edge cases for a specific type
 */
function getEdgeCasesForType(type) {
  const category = EDGE_CASE_CATEGORIES[type];
  return category ? category.cases : EDGE_CASE_CATEGORIES.OBJECT.cases;
}

/**
 * Generate edge cases for a class
 */
function generateClassEdgeCases(classDef) {
  const edgeCases = [];
  const { name, methods = [] } = classDef;
  
  // Constructor edge cases
  edgeCases.push({
    className: name,
    testCase: {
      description: "Instantiate with no arguments",
      type: "constructor"
    }
  });
  
  edgeCases.push({
    className: name,
    testCase: {
      description: "Instantiate with null arguments",
      type: "constructor"
    }
  });
  
  // Method edge cases
  methods.forEach(method => {
    const methodEdgeCases = generateFunctionEdgeCases({
      name: method.name,
      params: method.params
    });
    
    methodEdgeCases.forEach(edgeCase => {
      edgeCases.push({
        className: name,
        methodName: method.name,
        ...edgeCase
      });
    });
  });
  
  return edgeCases;
}

/**
 * Generate test code from edge cases
 */
function generateTestCode(edgeCases, language, fileName) {
  const testCases = [];
  
  edgeCases.forEach((edgeCase, index) => {
    const testName = `edgeCase_${index + 1}_${edgeCase.testCase.description.replace(/[^a-zA-Z0-9]/g, "_")}`;
    
    if (language === "javascript" || language === "typescript") {
      testCases.push(generateJavaScriptTest(testName, edgeCase));
    } else if (language === "python") {
      testCases.push(generatePythonTest(testName, edgeCase));
    } else if (language === "java") {
      testCases.push(generateJavaTest(testName, edgeCase));
    }
  });
  
  return wrapTestCases(testCases, language, fileName);
}

/**
 * Generate JavaScript/TypeScript test
 */
function generateJavaScriptTest(testName, edgeCase) {
  const { functionName, className, methodName, testCase } = edgeCase;
  const values = buildInvocationValues(edgeCase, serializeJavaScriptValue);
  const invocation = values.join(", ");

  if (className && methodName) {
    return `
  test('${testName}', () => {
    // ${testCase.description}
    const instance = createInstance('${className}');
    expect(instance).toBeDefined();
    expect(typeof instance['${methodName}']).toBe('function');
    expect(() => instance['${methodName}'](${invocation})).not.toThrow();
  });`;
  }

  if (className && testCase?.type === "constructor") {
    return `
  test('${testName}', () => {
    // ${testCase.description}
    const TargetClass = resolveClassExport('${className}');
    expect(() => new TargetClass()).not.toThrow();
  });`;
  }

  if (functionName) {
    return `
  test('${testName}', () => {
    // ${testCase.description}
    const target = resolveFunctionExport('${functionName}');
    expect(typeof target).toBe('function');
    expect(() => target(${invocation})).not.toThrow();
  });`;
  }

  return `
  test('${testName}', () => {
    // ${testCase.description}
    expect(true).toBe(true);
  });`;
}

/**
 * Generate Python test
 */
function generatePythonTest(testName, edgeCase) {
  const { functionName, testCase } = edgeCase;
  const invocation = buildInvocationValues(edgeCase, serializePythonValue).join(", ");
  
  return `
    def test_${testName}(self):
        """${testCase.description}"""
        # Test with edge case: ${testCase.description}
        try:
            result = ${functionName}(${invocation})
            self.assertIsNotNone(result)
        except Exception as e:
            self.fail(f"Function raised {type(e).__name__}: {e}")`;
}

/**
 * Generate Java test
 */
function generateJavaTest(testName, edgeCase) {
  const { functionName, testCase } = edgeCase;
  const invocation = buildInvocationValues(edgeCase, serializeJavaValue).join(", ");
  
  return `
    @Test
    public void ${testName}() {
      // ${testCase.description}
      assertDoesNotThrow(() -> {
            ${functionName}(${invocation});
        });
    }`;
}

/**
 * Wrap test cases in appropriate test framework structure
 */
function wrapTestCases(testCases, language, fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  
  if (language === "javascript" || language === "typescript") {
    const requirePath = buildJavaScriptRequirePath(fileName);
    return `/**
 * Edge case tests for ${fileName}
 * Generated by Code Janitor
 */

const sourceModule = require('${requirePath}');
const defaultExport = sourceModule && sourceModule.default ? sourceModule.default : sourceModule;

function resolveFunctionExport(name) {
  if (sourceModule && typeof sourceModule[name] === 'function') {
    return sourceModule[name];
  }
  if (defaultExport && typeof defaultExport[name] === 'function') {
    return defaultExport[name];
  }
  if (typeof defaultExport === 'function') {
    return defaultExport;
  }
  if (typeof sourceModule === 'function') {
    return sourceModule;
  }
  throw new Error(\`Could not resolve function export: \${name}\`);
}

function resolveClassExport(name) {
  if (sourceModule && typeof sourceModule[name] === 'function') {
    return sourceModule[name];
  }
  if (defaultExport && typeof defaultExport[name] === 'function') {
    return defaultExport[name];
  }
  if (typeof defaultExport === 'function') {
    return defaultExport;
  }
  if (typeof sourceModule === 'function') {
    return sourceModule;
  }
  throw new Error(\`Could not resolve class export: \${name}\`);
}

function createInstance(name) {
  const TargetClass = resolveClassExport(name);
  return new TargetClass();
}

describe('${baseName} - Edge Cases', () => {
${testCases.join("\n")}
});
`;
  } else if (language === "python") {
    return `"""
Edge case tests for ${fileName}
Generated by Code Janitor
"""

import unittest
from ${baseName} import *

class ${baseName}EdgeCaseTests(unittest.TestCase):
${testCases.join("\n")}

if __name__ == '__main__':
    unittest.main()
`;
  } else if (language === "java") {
    return `/**
 * Edge case tests for ${fileName}
 * Generated by Code Janitor
 */

import org.junit.Test;
import static org.junit.Assert.*;

public class ${baseName}EdgeCaseTest {
${testCases.join("\n")}
}
`;
  }
  
  return testCases.join("\n");
}

/**
 * Main function to generate edge cases for a file
 */
async function generateEdgeCases(filePath, workspaceRoot, executionContext = {}) {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath);
    
    // Check if file exists
    try {
      await fs.access(absolutePath);
    } catch (error) {
      return {
        success: false,
        error: `File not found: ${filePath}`
      };
    }
    
    // Get language
    const language = getLanguage(filePath);
    if (!language) {
      return {
        success: false,
        error: `Unsupported file type: ${filePath}`
      };
    }
    
    // Parse file to get definitions
    const content = await fs.readFile(absolutePath, "utf-8");
    const parsedFile = await parseFile(filePath, workspaceRoot);
    let definitions = Array.isArray(parsedFile?.definitions)
      ? parsedFile.definitions
      : [];
    if (definitions.length === 0) {
      definitions = extractDefinitionsFallback(content, language);
    }
    
    if (definitions.length === 0) {
      return {
        success: false,
        error: `No code definitions found in: ${filePath}`
      };
    }
    
    // Generate edge cases for each definition
    const allEdgeCases = [];
    
    definitions.forEach(def => {
      if (def.type === "function") {
        const cases = generateFunctionEdgeCases(def);
        allEdgeCases.push(...cases);
      } else if (def.type === "class") {
        const cases = generateClassEdgeCases(def);
        allEdgeCases.push(...cases);
      }
    });
    
    const aiResult = await generateAiEdgeCases(
      filePath,
      workspaceRoot,
      language,
      content,
      definitions,
      allEdgeCases,
      executionContext
    ).catch(() => ({ edgeCases: [], notes: [] }));

    const mergedEdgeCases = dedupeEdgeCases(
      allEdgeCases.concat(aiResult.edgeCases || [])
    );

    // Generate test code
    const testCode = generateTestCode(mergedEdgeCases, language, filePath);
    
    // Determine test file path
    const testFileName = path.basename(filePath, path.extname(filePath)) +
                        ".edge-cases.test" + path.extname(filePath);
    const testFilePath = path.join(path.dirname(absolutePath), "__tests__", testFileName);
    
    return {
      success: true,
      filePath,
      language,
      edgeCaseCount: mergedEdgeCases.length,
      edgeCases: mergedEdgeCases,
      testCode,
      testFilePath: path.relative(workspaceRoot, testFilePath).replace(/\\/g, "/"),
      aiNotes: aiResult.notes || [],
      aiAugmentedCount: Array.isArray(aiResult.edgeCases)
        ? aiResult.edgeCases.length
        : 0,
      summary: {
        totalEdgeCases: mergedEdgeCases.length,
        byCategory: countByCategory(mergedEdgeCases),
        aiAugmentedCount: Array.isArray(aiResult.edgeCases)
          ? aiResult.edgeCases.length
          : 0,
        definitions: definitions.length
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Count edge cases by category
 */
function countByCategory(edgeCases) {
  const counts = {};
  edgeCases.forEach(ec => {
    const category = ec.category || "OTHER";
    counts[category] = (counts[category] || 0) + 1;
  });
  return counts;
}

/**
 * Validate edge case generation request
 */
function validateEdgeCaseRequest(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return {
      valid: false,
      error: "File path is required and must be a string"
    };
  }
  
  return { valid: true };
}

module.exports = {
  generateEdgeCases,
  validateEdgeCaseRequest,
  generateFunctionEdgeCases,
  generateClassEdgeCases,
  EDGE_CASE_CATEGORIES
};

// Made with Bob
