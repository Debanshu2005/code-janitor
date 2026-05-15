/**
 * Tests for list-code-definition-names tool
 */

const fs = require("fs").promises;
const path = require("path");
const {
  listCodeDefinitionNames,
  parseFile,
  getLanguage,
  LANGUAGE_MAP
} = require("../list-code-definition-names");

// Mock fs module
jest.mock("fs", () => ({
  promises: {
    stat: jest.fn(),
    readFile: jest.fn(),
    readdir: jest.fn()
  }
}));

describe("list-code-definition-names tool", () => {
  const mockWorkspaceRoot = "/workspace";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getLanguage", () => {
    it("should identify JavaScript files", () => {
      expect(getLanguage("app.js")).toBe("javascript");
      expect(getLanguage("utils.jsx")).toBe("javascript");
      expect(getLanguage("module.mjs")).toBe("javascript");
      expect(getLanguage("config.cjs")).toBe("javascript");
    });

    it("should identify TypeScript files", () => {
      expect(getLanguage("app.ts")).toBe("typescript");
      expect(getLanguage("component.tsx")).toBe("typescript");
    });

    it("should identify Python files", () => {
      expect(getLanguage("script.py")).toBe("python");
    });

    it("should identify Java files", () => {
      expect(getLanguage("Main.java")).toBe("java");
    });

    it("should identify C/C++ files", () => {
      expect(getLanguage("main.c")).toBe("c");
      expect(getLanguage("app.cpp")).toBe("cpp");
      expect(getLanguage("utils.cc")).toBe("cpp");
      expect(getLanguage("header.h")).toBe("c");
      expect(getLanguage("header.hpp")).toBe("cpp");
    });

    it("should return null for unsupported files", () => {
      expect(getLanguage("readme.md")).toBeNull();
      expect(getLanguage("data.json")).toBeNull();
      expect(getLanguage("image.png")).toBeNull();
    });

    it("should be case-insensitive", () => {
      expect(getLanguage("App.JS")).toBe("javascript");
      expect(getLanguage("Main.JAVA")).toBe("java");
    });
  });

  describe("parseFile - JavaScript", () => {
    it("should parse JavaScript class declarations", async () => {
      const jsCode = `
class MyClass {
  constructor() {}
  myMethod() {}
}
`;
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(jsCode));

      const result = await parseFile("test.js", mockWorkspaceRoot);

      expect(result.language).toBe("javascript");
      expect(result.definitions).toHaveLength(3);
      expect(result.definitions[0].name).toBe("MyClass");
      expect(result.definitions[0].type).toBe("class");
      expect(result.definitions[1].name).toBe("MyClass.constructor");
      expect(result.definitions[2].name).toBe("MyClass.myMethod");
    });

    it("should parse JavaScript function declarations", async () => {
      const jsCode = `
function myFunction() {
  return 42;
}

async function asyncFunction() {
  return await Promise.resolve(1);
}
`;
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(jsCode));

      const result = await parseFile("test.js", mockWorkspaceRoot);

      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].name).toBe("myFunction");
      expect(result.definitions[0].kind).toBe("function");
      expect(result.definitions[1].name).toBe("asyncFunction");
      expect(result.definitions[1].kind).toBe("async function");
    });

    it("should parse arrow functions", async () => {
      const jsCode = `
const myArrow = () => 42;
const myFunc = function() { return 1; };
`;
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(jsCode));

      const result = await parseFile("test.js", mockWorkspaceRoot);

      expect(result.definitions).toHaveLength(2);
      expect(result.definitions[0].name).toBe("myArrow");
      expect(result.definitions[0].kind).toBe("arrow function");
      expect(result.definitions[1].name).toBe("myFunc");
      expect(result.definitions[1].kind).toBe("function expression");
    });
  });

  describe("parseFile - TypeScript", () => {
    it("should parse TypeScript interfaces", async () => {
      const tsCode = `
interface User {
  name: string;
  age: number;
}

type Config = {
  debug: boolean;
};

enum Status {
  Active,
  Inactive
}
`;
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(tsCode));

      const result = await parseFile("test.ts", mockWorkspaceRoot);

      expect(result.language).toBe("typescript");
      expect(result.definitions.length).toBeGreaterThanOrEqual(3);
      
      const interfaceDef = result.definitions.find(d => d.name === "User");
      expect(interfaceDef).toBeDefined();
      expect(interfaceDef.type).toBe("interface");
      
      const typeDef = result.definitions.find(d => d.name === "Config");
      expect(typeDef).toBeDefined();
      expect(typeDef.type).toBe("type");
      
      const enumDef = result.definitions.find(d => d.name === "Status");
      expect(enumDef).toBeDefined();
      expect(enumDef.type).toBe("enum");
    });
  });

  describe("parseFile - Python", () => {
    it("should parse Python classes and methods", async () => {
      const pyCode = `
class MyClass:
    def __init__(self):
        pass
    
    def my_method(self):
        return 42

def standalone_function():
    return "hello"
`;
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(pyCode));

      const result = await parseFile("test.py", mockWorkspaceRoot);

      expect(result.language).toBe("python");
      expect(result.definitions.length).toBeGreaterThanOrEqual(3);
      
      const classDef = result.definitions.find(d => d.name === "MyClass");
      expect(classDef).toBeDefined();
      expect(classDef.type).toBe("class");
      
      const methodDef = result.definitions.find(d => d.name === "MyClass.__init__");
      expect(methodDef).toBeDefined();
      
      const funcDef = result.definitions.find(d => d.name === "standalone_function");
      expect(funcDef).toBeDefined();
      expect(funcDef.type).toBe("function");
    });
  });

  describe("parseFile - Java", () => {
    it("should parse Java classes and methods", async () => {
      const javaCode = `
public class MyClass {
    public void myMethod() {
        System.out.println("Hello");
    }
    
    private static int calculate(int x) {
        return x * 2;
    }
}

interface MyInterface {
    void doSomething();
}
`;
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(javaCode));

      const result = await parseFile("Test.java", mockWorkspaceRoot);

      expect(result.language).toBe("java");
      expect(result.definitions.length).toBeGreaterThanOrEqual(2);
      
      const classDef = result.definitions.find(d => d.name === "MyClass");
      expect(classDef).toBeDefined();
      expect(classDef.type).toBe("class");
      
      const interfaceDef = result.definitions.find(d => d.name === "MyInterface");
      expect(interfaceDef).toBeDefined();
      expect(interfaceDef.type).toBe("interface");
    });
  });

  describe("parseFile - C/C++", () => {
    it("should parse C++ classes and functions", async () => {
      const cppCode = `
class MyClass {
public:
    void myMethod();
    int calculate(int x);
};

void standalone_function() {
    // implementation
}

struct MyStruct {
    int value;
};
`;
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(cppCode));

      const result = await parseFile("test.cpp", mockWorkspaceRoot);

      expect(result.language).toBe("cpp");
      expect(result.definitions.length).toBeGreaterThanOrEqual(2);
      
      const classDef = result.definitions.find(d => d.name === "MyClass");
      expect(classDef).toBeDefined();
      
      const structDef = result.definitions.find(d => d.name === "MyStruct");
      expect(structDef).toBeDefined();
      expect(structDef.kind).toBe("struct");
    });
  });

  describe("error handling", () => {
    it("should handle file not found", async () => {
      fs.stat.mockRejectedValue({ code: "ENOENT" });

      await expect(
        listCodeDefinitionNames("nonexistent.js", mockWorkspaceRoot)
      ).rejects.toThrow("Path not found");
    });

    it("should handle file too large", async () => {
      fs.stat.mockResolvedValue({ size: 10 * 1024 * 1024, isFile: () => true });

      const result = await parseFile("large.js", mockWorkspaceRoot);

      expect(result.error).toContain("File too large");
    });

    it("should handle unsupported file type", async () => {
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from("some content"));

      const result = await parseFile("readme.md", mockWorkspaceRoot);

      expect(result.error).toContain("Unsupported file type");
    });

    it("should handle parse errors gracefully", async () => {
      const invalidJs = "class {{{{{ invalid syntax";
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(invalidJs));

      const result = await parseFile("invalid.js", mockWorkspaceRoot);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Failed to parse");
    });
  });

  describe("listCodeDefinitionNames - directory", () => {
    it("should analyze all files in a directory", async () => {
      const jsCode = "function test() {}";
      const pyCode = "def test():\n    pass";

      fs.stat.mockResolvedValue({ 
        isFile: () => false, 
        isDirectory: () => true 
      });
      
      fs.readdir.mockResolvedValue([
        { name: "app.js", isFile: () => true },
        { name: "utils.py", isFile: () => true },
        { name: "readme.md", isFile: () => true },
        { name: "subdir", isFile: () => false }
      ]);

      // Mock subsequent stat calls for files
      fs.stat
        .mockResolvedValueOnce({ isFile: () => false, isDirectory: () => true })
        .mockResolvedValueOnce({ size: 100, isFile: () => true })
        .mockResolvedValueOnce({ size: 100, isFile: () => true });

      fs.readFile
        .mockResolvedValueOnce(Buffer.from(jsCode))
        .mockResolvedValueOnce(Buffer.from(pyCode));

      const result = await listCodeDefinitionNames("src/", mockWorkspaceRoot);

      expect(result).toContain("app.js");
      expect(result).toContain("utils.py");
      expect(result).toContain("javascript");
      expect(result).toContain("python");
    });

    it("should handle empty directory", async () => {
      fs.stat.mockResolvedValue({ 
        isFile: () => false, 
        isDirectory: () => true 
      });
      fs.readdir.mockResolvedValue([]);

      const result = await listCodeDefinitionNames("empty/", mockWorkspaceRoot);

      expect(result).toContain("No supported source files found");
    });
  });

  describe("formatting", () => {
    it("should sort definitions by line number", async () => {
      const jsCode = `
function third() {}  // line 2
function first() {}  // line 3
function second() {} // line 4
`;
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(jsCode));

      const result = await parseFile("test.js", mockWorkspaceRoot);

      expect(result.definitions[0].line).toBeLessThan(result.definitions[1].line);
      expect(result.definitions[1].line).toBeLessThan(result.definitions[2].line);
    });

    it("should include line numbers in output", async () => {
      const jsCode = "function test() {}";
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(jsCode));

      const result = await listCodeDefinitionNames("test.js", mockWorkspaceRoot);

      expect(result).toContain("Line");
      expect(result).toMatch(/Line \d+/);
    });
  });

  describe("edge cases", () => {
    it("should handle files with no definitions", async () => {
      const jsCode = "// Just a comment\nconst x = 1;";
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(jsCode));

      const result = await parseFile("test.js", mockWorkspaceRoot);

      expect(result.definitions).toHaveLength(0);
      expect(result.definitionCount).toBe(0);
    });

    it("should handle absolute paths", async () => {
      const jsCode = "function test() {}";
      fs.stat.mockResolvedValue({ size: 1000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(jsCode));

      const absolutePath = "/absolute/path/test.js";
      const result = await parseFile(absolutePath, mockWorkspaceRoot);

      expect(result.path).toBe(absolutePath);
    });

    it("should limit definitions to MAX_DEFINITIONS_PER_FILE", async () => {
      // Create code with many functions
      const functions = Array.from({ length: 600 }, (_, i) => 
        `function func${i}() {}`
      ).join("\n");
      
      fs.stat.mockResolvedValue({ size: 10000, isFile: () => true });
      fs.readFile.mockResolvedValue(Buffer.from(functions));

      const result = await parseFile("test.js", mockWorkspaceRoot);

      expect(result.definitions.length).toBeLessThanOrEqual(500);
    });
  });
});

// Made with Bob