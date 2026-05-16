/**
 * generate-documentation.test.js
 * 
 * Tests for documentation generation tool
 */

const {
  generateDocumentation,
  validateDocumentationRequest,
  analyzeRepository,
  generateReadme,
  generateApiDocs,
  generateContributingGuide
} = require("../generate-documentation");
const fs = require("fs").promises;

// Mock dependencies
jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
    access: jest.fn()
  }
}));

describe("generate-documentation", () => {
  const mockWorkspaceRoot = "/test/workspace";
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe("validateDocumentationRequest", () => {
    it("should validate valid options", () => {
      const result = validateDocumentationRequest({
        type: "readme",
        includeApi: true
      });
      expect(result.valid).toBe(true);
    });
    
    it("should reject invalid type", () => {
      const result = validateDocumentationRequest({
        type: "invalid"
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid documentation type");
    });
    
    it("should accept valid types", () => {
      const validTypes = ["readme", "api", "contributing", "full"];
      
      validTypes.forEach(type => {
        const result = validateDocumentationRequest({ type });
        expect(result.valid).toBe(true);
      });
    });
    
    it("should reject non-object options", () => {
      const result = validateDocumentationRequest("invalid");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("object");
    });
  });
  
  describe("analyzeRepository", () => {
    it("should analyze repository structure", async () => {
      const mockPackageJson = {
        name: "test-project",
        version: "1.0.0",
        description: "Test project",
        dependencies: {
          express: "^4.0.0"
        }
      };
      
      const mockFiles = [
        { name: "app.js", isFile: () => true, isDirectory: () => false },
        { name: "utils.js", isFile: () => true, isDirectory: () => false }
      ];
      
      fs.readFile.mockResolvedValue(JSON.stringify(mockPackageJson));
      fs.readdir.mockResolvedValue(mockFiles);
      
      const analysis = await analyzeRepository(mockWorkspaceRoot, "src");
      
      expect(analysis.name).toBe("test-project");
      expect(analysis.version).toBe("1.0.0");
      expect(analysis.description).toBe("Test project");
      expect(analysis.dependencies).toHaveProperty("express");
    });
    
    it("should handle missing package.json", async () => {
      fs.readFile.mockRejectedValue(new Error("No package.json"));
      fs.readdir.mockResolvedValue([]);
      
      const analysis = await analyzeRepository(mockWorkspaceRoot, "src");
      
      expect(analysis.name).toBeDefined();
      expect(analysis.files).toEqual([]);
    });
    
    it("should collect language statistics", async () => {
      const mockFiles = [
        { name: "app.js", isFile: () => true, isDirectory: () => false },
        { name: "utils.js", isFile: () => true, isDirectory: () => false },
        { name: "main.py", isFile: () => true, isDirectory: () => false }
      ];
      
      fs.readFile.mockRejectedValue(new Error("No package.json"));
      fs.readdir.mockResolvedValue(mockFiles);
      
      const analysis = await analyzeRepository(mockWorkspaceRoot, "src");
      
      expect(analysis.languageStats).toHaveProperty("javascript");
      expect(analysis.languageStats).toHaveProperty("python");
    });
  });
  
  describe("generateReadme", () => {
    it("should generate README with all sections", async () => {
      const analysis = {
        name: "test-project",
        description: "A test project",
        version: "1.0.0",
        classes: [
          { name: "Calculator", file: "src/calc.js", methods: [] }
        ],
        functions: [
          { name: "add", file: "src/utils.js", params: [] }
        ],
        files: ["src/app.js", "src/utils.js"],
        languageStats: { javascript: 2 },
        dependencies: { express: "^4.0.0" }
      };
      
      const readme = await generateReadme(analysis, mockWorkspaceRoot);
      
      expect(readme.content).toContain("# test-project");
      expect(readme.content).toContain("A test project");
      expect(readme.content).toContain("## Features");
      expect(readme.content).toContain("## Installation");
      expect(readme.content).toContain("## Usage");
      expect(readme.content).toContain("## API Documentation");
      expect(readme.content).toContain("## Testing");
      expect(readme.content).toContain("## Contributing");
      expect(readme.content).toContain("## License");
    });
    
    it("should include version badge", async () => {
      const analysis = {
        name: "test-project",
        version: "2.5.0",
        classes: [],
        functions: [],
        files: [],
        languageStats: {},
        dependencies: {}
      };
      
      const readme = await generateReadme(analysis, mockWorkspaceRoot);
      
      expect(readme.content).toContain("![Version]");
      expect(readme.content).toContain("2.5.0");
    });
    
    it("should document classes with methods", async () => {
      const analysis = {
        name: "test-project",
        classes: [
          {
            name: "User",
            file: "src/models/user.js",
            description: "User model class",
            methods: [
              { name: "save", params: [] },
              { name: "delete", params: [] }
            ]
          }
        ],
        functions: [],
        files: [],
        languageStats: {},
        dependencies: {}
      };
      
      const readme = await generateReadme(analysis, mockWorkspaceRoot);
      
      expect(readme.content).toContain("### Classes");
      expect(readme.content).toContain("#### User");
      expect(readme.content).toContain("save");
      expect(readme.content).toContain("delete");
    });
  });
  
  describe("generateApiDocs", () => {
    it("should generate API documentation", async () => {
      const analysis = {
        classes: [
          {
            name: "Calculator",
            file: "src/calc.js",
            description: "Calculator class",
            methods: [
              {
                name: "add",
                params: [
                  { name: "a", type: "number", description: "First number" },
                  { name: "b", type: "number", description: "Second number" }
                ]
              }
            ]
          }
        ],
        functions: [
          {
            name: "multiply",
            file: "src/utils.js",
            params: [
              { name: "x", type: "number" },
              { name: "y", type: "number" }
            ]
          }
        ]
      };
      
      const apiDocs = await generateApiDocs(analysis, true);
      
      expect(apiDocs.content).toContain("# API Documentation");
      expect(apiDocs.content).toContain("## Classes");
      expect(apiDocs.content).toContain("### Calculator");
      expect(apiDocs.content).toContain("##### add");
      expect(apiDocs.content).toContain("**Parameters:**");
      expect(apiDocs.content).toContain("## Functions");
      expect(apiDocs.content).toContain("### multiply");
    });
    
    it("should include examples when requested", async () => {
      const analysis = {
        classes: [],
        functions: [
          {
            name: "sum",
            file: "src/math.js",
            params: [{ name: "numbers", type: "array" }]
          }
        ]
      };
      
      const apiDocs = await generateApiDocs(analysis, true);
      
      expect(apiDocs.content).toContain("**Example:**");
      expect(apiDocs.content).toContain("```javascript");
      expect(apiDocs.content).toContain("sum(numbers)");
    });
    
    it("should omit examples when not requested", async () => {
      const analysis = {
        classes: [],
        functions: [
          {
            name: "sum",
            file: "src/math.js",
            params: []
          }
        ]
      };
      
      const apiDocs = await generateApiDocs(analysis, false);
      
      expect(apiDocs.content).not.toContain("**Example:**");
    });
  });
  
  describe("generateContributingGuide", () => {
    it("should generate contributing guide", async () => {
      const analysis = {
        name: "test-project"
      };
      
      const guide = await generateContributingGuide(analysis);
      
      expect(guide.content).toContain("# Contributing Guide");
      expect(guide.content).toContain("test-project");
      expect(guide.content).toContain("## Getting Started");
      expect(guide.content).toContain("## Development Setup");
      expect(guide.content).toContain("## Coding Standards");
      expect(guide.content).toContain("## Testing");
      expect(guide.content).toContain("## Pull Request Process");
      expect(guide.content).toContain("## Code of Conduct");
    });
    
    it("should include git workflow steps", async () => {
      const analysis = { name: "project" };
      
      const guide = await generateContributingGuide(analysis);
      
      expect(guide.content).toContain("Fork the repository");
      expect(guide.content).toContain("git clone");
      expect(guide.content).toContain("git checkout");
      expect(guide.content).toContain("git commit");
      expect(guide.content).toContain("git push");
    });
  });
  
  describe("generateDocumentation", () => {
    it("should generate README documentation", async () => {
      const mockPackageJson = {
        name: "test-project",
        version: "1.0.0"
      };
      
      fs.readFile.mockResolvedValue(JSON.stringify(mockPackageJson));
      fs.readdir.mockResolvedValue([]);
      fs.mkdir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);
      
      const result = await generateDocumentation(
        { type: "readme" },
        mockWorkspaceRoot
      );
      
      expect(result.success).toBe(true);
      expect(result.type).toBe("readme");
      expect(result.documentation).toBeDefined();
      expect(result.outputPath).toBeDefined();
    });
    
    it("should generate full documentation suite", async () => {
      fs.readFile.mockResolvedValue(JSON.stringify({ name: "project" }));
      fs.readdir.mockResolvedValue([]);
      fs.mkdir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);
      
      const result = await generateDocumentation(
        { type: "full" },
        mockWorkspaceRoot
      );
      
      expect(result.success).toBe(true);
      expect(result.documentation.additional).toBeDefined();
      expect(result.documentation.additional.api).toBeDefined();
      expect(result.documentation.additional.contributing).toBeDefined();
    });
    
    it("should handle errors gracefully", async () => {
      fs.readFile.mockRejectedValue(new Error("Read error"));
      
      const result = await generateDocumentation(
        { type: "readme" },
        mockWorkspaceRoot
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
    
    it("should return error for unknown type", async () => {
      const result = await generateDocumentation(
        { type: "unknown" },
        mockWorkspaceRoot
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown documentation type");
    });
  });
});

// Made with Bob
