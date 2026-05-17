/**
 * generate-edge-cases.test.js
 * 
 * Tests for edge case generation tool
 */

const {
  generateEdgeCases,
  validateEdgeCaseRequest,
  generateFunctionEdgeCases,
  generateClassEdgeCases,
  EDGE_CASE_CATEGORIES
} = require("../generate-edge-cases");
const fs = require("fs").promises;
const path = require("path");

// Mock fs
jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    access: jest.fn()
  }
}));

describe("generate-edge-cases", () => {
  const mockWorkspaceRoot = "/test/workspace";
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe("validateEdgeCaseRequest", () => {
    it("should validate valid file path", () => {
      const result = validateEdgeCaseRequest("src/app.js");
      expect(result.valid).toBe(true);
    });
    
    it("should reject missing file path", () => {
      const result = validateEdgeCaseRequest(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("required");
    });
    
    it("should reject non-string file path", () => {
      const result = validateEdgeCaseRequest(123);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("string");
    });
  });
  
  describe("generateFunctionEdgeCases", () => {
    it("should generate edge cases for function with parameters", () => {
      const functionDef = {
        name: "calculateSum",
        params: [
          { name: "a", type: "number" },
          { name: "b", type: "number" }
        ]
      };
      
      const edgeCases = generateFunctionEdgeCases(functionDef);
      
      expect(edgeCases.length).toBeGreaterThan(0);
      expect(edgeCases[0]).toHaveProperty("functionName", "calculateSum");
      expect(edgeCases[0]).toHaveProperty("testCase");
      expect(edgeCases[0]).toHaveProperty("category");
    });
    
    it("should generate combination edge cases for multiple parameters", () => {
      const functionDef = {
        name: "multiply",
        params: [
          { name: "x", type: "number" },
          { name: "y", type: "number" }
        ]
      };
      
      const edgeCases = generateFunctionEdgeCases(functionDef);
      const combinationCases = edgeCases.filter(ec => ec.category === "COMBINATION");
      
      expect(combinationCases.length).toBeGreaterThan(0);
    });
    
    it("should handle function with no parameters", () => {
      const functionDef = {
        name: "getCurrentTime",
        params: []
      };
      
      const edgeCases = generateFunctionEdgeCases(functionDef);
      
      expect(Array.isArray(edgeCases)).toBe(true);
    });
  });
  
  describe("generateClassEdgeCases", () => {
    it("should generate edge cases for class with methods", () => {
      const classDef = {
        name: "Calculator",
        methods: [
          {
            name: "add",
            params: [
              { name: "a", type: "number" },
              { name: "b", type: "number" }
            ]
          }
        ]
      };
      
      const edgeCases = generateClassEdgeCases(classDef);
      
      expect(edgeCases.length).toBeGreaterThan(0);
      expect(edgeCases.some(ec => ec.className === "Calculator")).toBe(true);
    });
    
    it("should generate constructor edge cases", () => {
      const classDef = {
        name: "User",
        methods: []
      };
      
      const edgeCases = generateClassEdgeCases(classDef);
      const constructorCases = edgeCases.filter(ec => ec.testCase?.type === "constructor");
      
      expect(constructorCases.length).toBeGreaterThan(0);
    });
  });
  
  describe("generateEdgeCases", () => {
    it("should generate edge cases for JavaScript file", async () => {
      const filePath = "src/calculator.js";
      const mockContent = `
        function add(a, b) {
          return a + b;
        }
        
        function multiply(x, y) {
          return x * y;
        }
      `;
      
      fs.access.mockResolvedValue(undefined);
      fs.readFile.mockResolvedValue(mockContent);
      
      const result = await generateEdgeCases(filePath, mockWorkspaceRoot);
      
      expect(result.success).toBe(true);
      expect(result.language).toBe("javascript");
      expect(result.edgeCaseCount).toBeGreaterThan(0);
      expect(result.testCode).toBeDefined();
      expect(result.testFilePath).toBe("src/__tests__/calculator.edge-cases.test.js");
      expect(result.testCode).toContain("const sourceModule = require('../calculator')");
      expect(result.testCode).toContain("resolveFunctionExport");
      expect(result.testCode).toContain("target({}, undefined)");
    });
    
    it("should return error for non-existent file", async () => {
      const filePath = "nonexistent.js";
      
      fs.access.mockRejectedValue(new Error("File not found"));
      
      const result = await generateEdgeCases(filePath, mockWorkspaceRoot);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
    
    it("should return error for unsupported file type", async () => {
      const filePath = "document.txt";
      
      fs.access.mockResolvedValue(undefined);
      
      const result = await generateEdgeCases(filePath, mockWorkspaceRoot);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported");
    });
    
    it("should return error for file with no definitions", async () => {
      const filePath = "empty.js";
      const mockContent = "// Empty file";
      
      fs.access.mockResolvedValue(undefined);
      fs.readFile.mockResolvedValue(mockContent);
      
      const result = await generateEdgeCases(filePath, mockWorkspaceRoot);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("No code definitions");
    });
  });
  
  describe("EDGE_CASE_CATEGORIES", () => {
    it("should have numeric edge cases", () => {
      expect(EDGE_CASE_CATEGORIES.NUMERIC).toBeDefined();
      expect(EDGE_CASE_CATEGORIES.NUMERIC.cases.length).toBeGreaterThan(0);
    });
    
    it("should have string edge cases", () => {
      expect(EDGE_CASE_CATEGORIES.STRING).toBeDefined();
      expect(EDGE_CASE_CATEGORIES.STRING.cases.length).toBeGreaterThan(0);
    });
    
    it("should have array edge cases", () => {
      expect(EDGE_CASE_CATEGORIES.ARRAY).toBeDefined();
      expect(EDGE_CASE_CATEGORIES.ARRAY.cases.length).toBeGreaterThan(0);
    });
    
    it("should include security-related edge cases", () => {
      const stringCases = EDGE_CASE_CATEGORIES.STRING.cases;
      const hasXSS = stringCases.some(c => c.description.toLowerCase().includes("xss"));
      const hasSQLInjection = stringCases.some(c => c.description.toLowerCase().includes("sql"));
      
      expect(hasXSS || hasSQLInjection).toBe(true);
    });
  });
});

// Made with Bob
