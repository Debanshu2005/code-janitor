/**
 * execute-tests.test.js
 * 
 * Tests for test execution tool
 */

const {
  executeTests,
  validateTestRequest,
  detectTestFramework,
  findTestFiles,
  parseTestResults,
  generateTestReport,
  buildTestCommand,
  resolveFrameworkCommand
} = require("../execute-tests");
const fs = require("fs").promises;
const { execFile } = require("child_process");
const path = require("path");

// Mock dependencies
jest.mock("fs", () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
    access: jest.fn(),
    unlink: jest.fn()
  }
}));

jest.mock("child_process");

describe("execute-tests", () => {
  const mockWorkspaceRoot = "/test/workspace";
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe("validateTestRequest", () => {
    it("should validate valid options object", () => {
      const result = validateTestRequest({
        testPath: "src/__tests__/app.test.js",
        framework: "jest"
      });
      expect(result.valid).toBe(true);
    });
    
    it("should reject non-object options", () => {
      const result = validateTestRequest("invalid");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("object");
    });
    
    it("should accept empty options", () => {
      const result = validateTestRequest({});
      expect(result.valid).toBe(true);
    });
  });
  
  describe("detectTestFramework", () => {
    it("should detect Jest from package.json", async () => {
      const mockPackageJson = {
        devDependencies: {
          jest: "^29.0.0"
        }
      };
      
      fs.readFile.mockResolvedValue(JSON.stringify(mockPackageJson));
      
      const framework = await detectTestFramework(mockWorkspaceRoot, "javascript");
      
      expect(framework).toBeDefined();
      expect(framework.name).toBe("jest");
    });
    
    it("should detect pytest from config files", async () => {
      fs.readFile.mockRejectedValue(new Error("No package.json"));
      fs.access.mockResolvedValueOnce(undefined); // pytest.ini exists
      
      const framework = await detectTestFramework(mockWorkspaceRoot, "python");
      
      expect(framework).toBeDefined();
      expect(framework.name).toBe("pytest");
    });

    it("should detect Jest from the test script", async () => {
      const mockPackageJson = {
        scripts: {
          test: "jest --runInBand"
        }
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockPackageJson));

      const framework = await detectTestFramework(mockWorkspaceRoot, "javascript");

      expect(framework).toBeDefined();
      expect(framework.name).toBe("jest");
    });
    
    it("should return null for unsupported language", async () => {
      const framework = await detectTestFramework(mockWorkspaceRoot, "unsupported");
      expect(framework).toBeNull();
    });
  });
  
  describe("findTestFiles", () => {
    it("should find test files matching pattern", async () => {
      const mockEntries = [
        { name: "app.test.js", isFile: () => true, isDirectory: () => false },
        { name: "utils.test.js", isFile: () => true, isDirectory: () => false },
        { name: "app.js", isFile: () => true, isDirectory: () => false }
      ];
      
      fs.readdir.mockResolvedValue(mockEntries);
      
      const testPattern = /\.(test|spec)\.(js|ts)$/;
      const testFiles = await findTestFiles(mockWorkspaceRoot, testPattern);
      
      expect(testFiles.length).toBe(2);
      expect(testFiles).toContain("app.test.js");
      expect(testFiles).toContain("utils.test.js");
    });
    
    it("should skip node_modules directory", async () => {
      const mockEntries = [
        { name: "node_modules", isFile: () => false, isDirectory: () => true },
        { name: "src", isFile: () => false, isDirectory: () => true }
      ];
      
      fs.readdir.mockImplementation(async (dirPath) => {
        if (dirPath === mockWorkspaceRoot) {
          return mockEntries;
        }
        return [];
      });
      
      const testPattern = /\.test\.js$/;
      await findTestFiles(mockWorkspaceRoot, testPattern);
      
      expect(fs.readdir).toHaveBeenCalledTimes(2);
    });
  });
  
  describe("parseTestResults", () => {
    it("should parse Jest test results", () => {
      const stdout = `
        Tests: 2 failed, 8 passed, 10 total
        Snapshots: 0 total
        Time: 5.123s
      `;
      
      const results = parseTestResults(stdout, "", "jest");
      
      expect(results.total).toBe(10);
      expect(results.passed).toBe(8);
      expect(results.failed).toBe(2);
    });

    it("should parse Jest results when all tests pass and todos are present", () => {
      const stdout = `
        Test Suites: 1 passed, 1 total
        Tests:       2 todo, 3 passed, 5 total
        Snapshots:   0 total
        Time:        1.234 s
      `;

      const results = parseTestResults(stdout, "", "jest");

      expect(results.total).toBe(5);
      expect(results.passed).toBe(3);
      expect(results.failed).toBe(0);
      expect(results.skipped).toBe(2);
    });

    it("should parse Jest summary when it is emitted to stderr", () => {
      const stderr = `
        PASS src/example.test.js
        Tests:       1 todo, 3 passed, 4 total
      `;

      const results = parseTestResults("", stderr, "jest");

      expect(results.total).toBe(4);
      expect(results.passed).toBe(3);
      expect(results.failed).toBe(0);
      expect(results.skipped).toBe(1);
    });
    
    it("should parse pytest test results", () => {
      const stdout = `
        ===== test session starts =====
        collected 15 items
        
        10 passed, 3 failed, 2 skipped in 2.34s
      `;
      
      const results = parseTestResults(stdout, "", "pytest");
      
      expect(results.passed).toBe(10);
      expect(results.failed).toBe(3);
      expect(results.skipped).toBe(2);
      expect(results.total).toBe(15);
    });
    
    it("should parse JUnit test results", () => {
      const stdout = `
        Tests run: 20, Failures: 2, Errors: 1, Skipped: 3
      `;
      
      const results = parseTestResults(stdout, "", "junit");
      
      expect(results.total).toBe(20);
      expect(results.failed).toBe(3); // Failures + Errors
      expect(results.skipped).toBe(3);
      expect(results.passed).toBe(14);
    });
    
    it("should handle generic test output", () => {
      const stdout = `
        Test 1: passed
        Test 2: failed
        Test 3: passed
      `;
      
      const results = parseTestResults(stdout, "", "unknown");
      
      expect(results.total).toBeGreaterThan(0);
      expect(results.passed).toBeGreaterThan(0);
    });
  });
  
  describe("generateTestReport", () => {
    it("should generate comprehensive test report", async () => {
      const results = {
        total: 10,
        passed: 8,
        failed: 2,
        skipped: 0,
        errors: ["Test 1 failed", "Test 2 failed"]
      };
      
      const options = {
        framework: "jest",
        duration: 5000,
        testFiles: ["app.test.js", "utils.test.js"],
        workspaceRoot: mockWorkspaceRoot
      };
      
      fs.mkdir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);
      
      const report = await generateTestReport(results, options);
      
      expect(report).toBeDefined();
      expect(report.summary.total).toBe(10);
      expect(report.summary.passed).toBe(8);
      expect(report.summary.failed).toBe(2);
      expect(report.summary.successRate).toBe("80.00");
      expect(report.markdown).toContain("Test Report");
      expect(report.markdown).toContain("jest");
    });
    
    it("should include failed test details in markdown", async () => {
      const results = {
        total: 5,
        passed: 3,
        failed: 2,
        skipped: 0,
        errors: ["Error in test A", "Error in test B"]
      };
      
      const options = {
        framework: "mocha",
        duration: 3000,
        testFiles: ["test.js"],
        workspaceRoot: mockWorkspaceRoot
      };
      
      fs.mkdir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);
      
      const report = await generateTestReport(results, options);
      
      expect(report.markdown).toContain("Failed Tests");
      expect(report.markdown).toContain("Error in test A");
      expect(report.markdown).toContain("Error in test B");
    });
  });

  describe("buildTestCommand", () => {
    it("should build a Jest command for a specific test file", () => {
      const command = buildTestCommand(
        { name: "jest", command: "npx", args: ["jest"] },
        "src/__tests__/cli.test.js"
      );

      expect(command).toEqual({
        command: "npx",
        args: ["jest", "--runTestsByPath", "src/__tests__/cli.test.js"]
      });
    });

    it("passes shell metacharacters as data arguments", () => {
      const command = buildTestCommand(
        { name: "jest", command: "npx", args: ["jest"] },
        "src/__tests__/weird;rm -rf .test.js"
      );

      expect(command.args).toContain("src/__tests__/weird;rm -rf .test.js");
    });
  });

  describe("resolveFrameworkCommand", () => {
    it("should prefer the local Jest entrypoint when available", async () => {
      fs.access.mockResolvedValue(undefined);

      const command = await resolveFrameworkCommand(
        { name: "jest", command: "npx jest" },
        mockWorkspaceRoot
      );

      expect(command).toEqual({
        command: process.execPath,
        args: [path.join(mockWorkspaceRoot, "node_modules", "jest", "bin", "jest.js")]
      });
      expect(fs.access).toHaveBeenCalledWith(
        path.join(mockWorkspaceRoot, "node_modules", "jest", "bin", "jest.js")
      );
    });

    it("should fall back to the configured command when no local binary is found", async () => {
      fs.access.mockRejectedValue(new Error("missing"));

      const command = await resolveFrameworkCommand(
        { name: "jest", command: "npx jest" },
        mockWorkspaceRoot
      );

      expect(command).toEqual({
        command: "npx",
        args: ["jest"]
      });
    });
  });
  
  describe("executeTests", () => {
    it("should execute tests and return results", async () => {
      const mockPackageJson = {
        devDependencies: { jest: "^29.0.0" }
      };
      
      fs.readFile.mockResolvedValue(JSON.stringify(mockPackageJson));
      fs.access.mockResolvedValue(undefined);
      fs.readdir.mockResolvedValue([
        { name: "app.test.js", isFile: () => true, isDirectory: () => false }
      ]);
      fs.mkdir.mockResolvedValue(undefined);
      fs.writeFile.mockResolvedValue(undefined);
      
      execFile.mockImplementation((_command, _args, _options, callback) => {
        callback(null, "Tests: 0 failed, 5 passed, 5 total", "");
      });
      
      const result = await executeTests({
        framework: "jest",
        testPath: "app.test.js",
        temporaryTestPaths: ["app.test.js"]
      }, mockWorkspaceRoot);
      
      expect(result.success).toBe(true);
      expect(result.framework).toBe("jest");
      expect(result.results).toBeDefined();
      expect(execFile).toHaveBeenCalledWith(
        process.execPath,
        [
          path.join(mockWorkspaceRoot, "node_modules", "jest", "bin", "jest.js"),
          "--runTestsByPath",
          "app.test.js"
        ],
        expect.objectContaining({ cwd: mockWorkspaceRoot }),
        expect.any(Function)
      );
      expect(fs.unlink).toHaveBeenCalledWith(path.resolve(mockWorkspaceRoot, "app.test.js"));
    });
    
    it("should handle test execution errors", async () => {
      const mockPackageJson = {
        devDependencies: { jest: "^29.0.0" }
      };
      
      fs.readFile.mockResolvedValue(JSON.stringify(mockPackageJson));
      fs.access.mockResolvedValue(undefined);
      fs.readdir.mockResolvedValue([
        { name: "app.test.js", isFile: () => true, isDirectory: () => false }
      ]);
      
      execFile.mockImplementation((_command, _args, _options, callback) => {
        const error = new Error("Test execution failed");
        error.stdout = "";
        error.stderr = "";
        callback(error, "", "");
      });
      
      const result = await executeTests({
        framework: "jest",
        testPath: "app.test.js"
      }, mockWorkspaceRoot);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects test paths outside the workspace", async () => {
      const result = await executeTests({
        framework: "jest",
        testPath: "../outside.test.js"
      }, mockWorkspaceRoot);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid test path");
      expect(execFile).not.toHaveBeenCalled();
    });
  });
});

// Made with Bob
