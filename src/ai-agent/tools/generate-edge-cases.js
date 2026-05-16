/**
 * generate-edge-cases.js
 * 
 * Tool for generating edge cases for code testing
 */

const fs = require("fs").promises;
const path = require("path");
const { parseFile, getLanguage } = require("./list-code-definition-names");

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
        testCase: edgeCase,
        category: paramType
      });
    });
  });
  
  // Add combination edge cases
  if (params.length > 1) {
    edgeCases.push({
      functionName: name,
      testCase: {
        description: "All parameters null",
        values: params.map(() => null)
      },
      category: "COMBINATION"
    });
    
    edgeCases.push({
      functionName: name,
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
  const { functionName, testCase, parameterName } = edgeCase;
  const value = JSON.stringify(testCase.value);
  
  return `
  test('${testName}', () => {
    // ${testCase.description}
    const input = ${value};
    expect(() => ${functionName}(input)).not.toThrow();
  });`;
}

/**
 * Generate Python test
 */
function generatePythonTest(testName, edgeCase) {
  const { functionName, testCase } = edgeCase;
  
  return `
    def test_${testName}(self):
        """${testCase.description}"""
        # Test with edge case: ${testCase.description}
        try:
            result = ${functionName}(${JSON.stringify(testCase.value)})
            self.assertIsNotNone(result)
        except Exception as e:
            self.fail(f"Function raised {type(e).__name__}: {e}")`;
}

/**
 * Generate Java test
 */
function generateJavaTest(testName, edgeCase) {
  const { functionName, testCase } = edgeCase;
  
  return `
    @Test
    public void ${testName}() {
        // ${testCase.description}
        assertDoesNotThrow(() -> {
            ${functionName}(${JSON.stringify(testCase.value)});
        });
    }`;
}

/**
 * Wrap test cases in appropriate test framework structure
 */
function wrapTestCases(testCases, language, fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  
  if (language === "javascript" || language === "typescript") {
    return `/**
 * Edge case tests for ${fileName}
 * Generated by Code Janitor
 */

const { ${baseName} } = require('./${baseName}');

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
    const definitions = await parseFile(content, language, filePath);
    
    if (!definitions || definitions.length === 0) {
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
    
    // Generate test code
    const testCode = generateTestCode(allEdgeCases, language, filePath);
    
    // Determine test file path
    const testFileName = path.basename(filePath, path.extname(filePath)) + 
                        ".edge-cases" + path.extname(filePath);
    const testFilePath = path.join(path.dirname(absolutePath), "__tests__", testFileName);
    
    return {
      success: true,
      filePath,
      language,
      edgeCaseCount: allEdgeCases.length,
      edgeCases: allEdgeCases,
      testCode,
      testFilePath: path.relative(workspaceRoot, testFilePath),
      summary: {
        totalEdgeCases: allEdgeCases.length,
        byCategory: countByCategory(allEdgeCases),
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
