/**
 * Tests for apply_diff recovery mechanisms
 */

const { applyDiff, applyDiffToContent } = require("../apply-diff");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");

describe("apply_diff recovery scenarios", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "apply-diff-recovery-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  test("handles search block not found error", async () => {
    const testFile = path.join(tempDir, "test.js");
    await fs.writeFile(
      testFile,
      `function hello() {
  console.log("Hello");
}

function world() {
  console.log("World");
}`,
      "utf8"
    );

    const diff = `<<<<<<< SEARCH
:start_line:1
-------
function goodbye() {
  console.log("Goodbye");
}
=======
function hello() {
  console.log("Hello, World!");
}
>>>>>>> REPLACE`;

    await expect(applyDiff(testFile, diff, tempDir)).rejects.toThrow(
      /Search block not found/
    );
  });

  test("successfully applies diff with unique search block", async () => {
    const testFile = path.join(tempDir, "test.js");
    await fs.writeFile(
      testFile,
      `function hello() {
  console.log("Hello");
}

function world() {
  console.log("World");
}`,
      "utf8"
    );

    const diff = `<<<<<<< SEARCH
:start_line:1
-------
function hello() {
  console.log("Hello");
}
=======
function hello() {
  console.log("Hello, World!");
}
>>>>>>> REPLACE`;

    const result = await applyDiff(testFile, diff, tempDir);

    expect(result.success).toBe(true);
    expect(result.blocksApplied).toBe(1);

    const content = await fs.readFile(testFile, "utf8");
    expect(content).toContain('console.log("Hello, World!")');
  });

  test("applies multiple diff blocks in correct order", async () => {
    const testFile = path.join(tempDir, "test.js");
    await fs.writeFile(
      testFile,
      `const x = 1;
const y = 2;
const z = 3;`,
      "utf8"
    );

    const diff = `<<<<<<< SEARCH
:start_line:1
-------
const x = 1;
=======
const x = 10;
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:3
-------
const z = 3;
=======
const z = 30;
>>>>>>> REPLACE`;

    const result = await applyDiff(testFile, diff, tempDir);

    expect(result.success).toBe(true);
    expect(result.blocksApplied).toBe(2);

    const content = await fs.readFile(testFile, "utf8");
    expect(content).toContain("const x = 10");
    expect(content).toContain("const y = 2");
    expect(content).toContain("const z = 30");
  });

  test("fuzzy matches with whole-file search when line number is far off", async () => {
    const testFile = path.join(tempDir, "test.js");
    await fs.writeFile(testFile, `const x = 1;\nconst y = 2;`, "utf8");

    const diff = `<<<<<<< SEARCH
:start_line:100
-------
const x = 1;
=======
const x = 10;
>>>>>>> REPLACE`;

    // The tool now does whole-file search as fallback
    const result = await applyDiff(testFile, diff, tempDir);
    
    expect(result.success).toBe(true);
    expect(result.details[0].warning).toContain("whole-file search");

    const content = await fs.readFile(testFile, "utf8");
    expect(content).toContain("const x = 10");
  });

  test("fuzzy matches when line number is slightly off", async () => {
    const testFile = path.join(tempDir, "test.js");
    await fs.writeFile(
      testFile,
      `// Comment
function hello() {
  console.log("Hello");
}`,
      "utf8"
    );

    // Specify line 1 but actual function starts at line 2
    const diff = `<<<<<<< SEARCH
:start_line:1
-------
function hello() {
  console.log("Hello");
}
=======
function hello() {
  console.log("Hi");
}
>>>>>>> REPLACE`;

    const result = await applyDiff(testFile, diff, tempDir);

    expect(result.success).toBe(true);
    expect(result.details[0].warning).toBeDefined();

    const content = await fs.readFile(testFile, "utf8");
    expect(content).toContain('console.log("Hi")');
  });

  test("preserves line endings (CRLF)", async () => {
    const testFile = path.join(tempDir, "test.js");
    await fs.writeFile(testFile, "const x = 1;\r\nconst y = 2;\r\n", "utf8");

    const diff = `<<<<<<< SEARCH
:start_line:1
-------
const x = 1;
=======
const x = 10;
>>>>>>> REPLACE`;

    const result = await applyDiff(testFile, diff, tempDir);

    expect(result.success).toBe(true);

    const content = await fs.readFile(testFile, "utf8");
    expect(content).toContain("\r\n");
    expect(content).toContain("const x = 10");
  });

  test("rejects syntax-invalid changes for JavaScript", async () => {
    const testFile = path.join(tempDir, "test.js");
    await fs.writeFile(
      testFile,
      `function hello() {
  return "world";
}`,
      "utf8"
    );

    const diff = `<<<<<<< SEARCH
:start_line:1
-------
function hello() {
  return "world";
}
=======
function hello() {
  return "world"
  // Missing semicolon and brace
>>>>>>> REPLACE`;

    await expect(applyDiff(testFile, diff, tempDir)).rejects.toThrow(
      /syntax/i
    );
  });

  test("applyDiffToContent works without filesystem", () => {
    const content = "line 1\nline 2\nline 3\n";
    const diff = `<<<<<<< SEARCH
:start_line:2
-------
line 2
=======
line TWO
>>>>>>> REPLACE`;

    const result = applyDiffToContent(content, diff);

    expect(result.blocksApplied).toBe(1);
    expect(result.newContent).toContain("line TWO");
    expect(result.newContent).toContain("line 1");
    expect(result.newContent).toContain("line 3");
  });
});

// Made with Bob
