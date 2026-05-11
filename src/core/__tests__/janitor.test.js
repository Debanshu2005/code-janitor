/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

const mockFindFiles = jest.fn();
const mockGetFixerForFile = jest.fn();
const mockIsFileTypeSupported = jest.fn();

jest.mock("../fixers/index", () => ({
  FIXER_MAP: {
    ".js": class MockJavaScriptFixer {}
  },
  getFixerForFile: (...args) => mockGetFixerForFile(...args),
  isFileTypeSupported: (...args) => mockIsFileTypeSupported(...args)
}));

jest.mock("../../utils/file-finder", () => ({
  findFiles: (...args) => mockFindFiles(...args)
}));

const { analyzeAndFixDirectory, analyzeTarget } = require("../janitor");

class UppercaseFixer {
  constructor(code) {
    this.code = code;
    this.fixes = [{ range: [0, code.length], text: code.toUpperCase() }];
  }

  async analyze() {
    return {
      fixedCode: this.code.toUpperCase(),
      appliedFixes: 1
    };
  }
}

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "code-janitor-janitor-"));
}

describe("janitor core", () => {
  const workspaces = [];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    while (workspaces.length > 0) {
      fs.rmSync(workspaces.pop(), { recursive: true, force: true });
    }
  });

  test("checks a single supported file without writing changes", async () => {
    const workspace = createWorkspace();
    const filePath = path.join(workspace, "sample.js");
    workspaces.push(workspace);

    fs.writeFileSync(filePath, "const value = 1;\n", "utf8");
    mockIsFileTypeSupported.mockReturnValue(true);
    mockGetFixerForFile.mockReturnValue(UppercaseFixer);

    const report = await analyzeTarget(filePath, { write: false });

    expect(report.mode).toBe("check");
    expect(report.filesProcessed).toBe(1);
    expect(report.filesFixed).toBe(1);
    expect(report.filesWritten).toBe(0);
    expect(report.totalFixes).toBe(1);
    expect(fs.readFileSync(filePath, "utf8")).toBe("const value = 1;\n");
  });

  test("writes fixes for files discovered in a directory", async () => {
    const workspace = createWorkspace();
    const firstFile = path.join(workspace, "one.js");
    const secondFile = path.join(workspace, "two.js");
    workspaces.push(workspace);

    fs.writeFileSync(firstFile, "first\n", "utf8");
    fs.writeFileSync(secondFile, "second\n", "utf8");

    mockFindFiles.mockResolvedValue([firstFile, secondFile]);
    mockGetFixerForFile.mockReturnValue(UppercaseFixer);

    const report = await analyzeAndFixDirectory(workspace);

    expect(report.mode).toBe("write");
    expect(report.filesProcessed).toBe(2);
    expect(report.filesFixed).toBe(2);
    expect(report.filesWritten).toBe(2);
    expect(report.fixedFiles).toEqual([firstFile, secondFile]);
    expect(fs.readFileSync(firstFile, "utf8")).toBe("FIRST\n");
    expect(fs.readFileSync(secondFile, "utf8")).toBe("SECOND\n");
  });
});
