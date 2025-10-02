const fs = require("fs").promises;
const path = require("path");
const PythonFixer = require("./python-fixer");

async function testPythonFixer() {
  // 1️⃣ Create a messy Python test code
  const messyPython = `def main()
 print("Hello World")
 if True
  print "ok"
 else
  print "not ok"

for i in range(3)
 print i
`;

  const tempDir = __dirname;
  const tempFile = path.join(tempDir, "test_messy.py");

  // Write messy code to temp file
  await fs.writeFile(tempFile, messyPython);
  console.log("Messy Python code written to:", tempFile);

  // 2️⃣ Initialize PythonFixer
  const fixer = new PythonFixer();

  // Read the actual file content
  const fileContent = await fs.readFile(tempFile, "utf8");

  // Set the file path and code content properly
  fixer.filePath = tempFile;
  fixer.code = fileContent;

  // 3️⃣ Test Black installation first
  console.log("Testing Black installation...");
  await fixer.testBlack();

  // 4️⃣ Run the fixer
  console.log("Starting analysis...");
  await fixer.analyze();

  // 5️⃣ Get the fixed code
  const fixedCode = fixer.getFixedCode();

  console.log("\n================ Fixed Python Code ================\n");
  console.log(fixedCode);

  // 6️⃣ Write fixed code to a new file
  const fixedFile = path.join(tempDir, "test_fixed.py");
  await fs.writeFile(fixedFile, fixedCode);
  console.log("\n✅ Fixed Python code written to:", fixedFile);

  console.log("\n🎉 Test completed!");
}

testPythonFixer().catch((err) => console.error("Test failed:", err));
