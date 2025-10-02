const fs = require("fs").promises;
const path = require("path");
const PythonFixer = require("../python-fixer"); // Adjust path if needed

async function testPythonFixer() {
  // 1️⃣ Create a messy Python test code
  const messyPython = `
def main()
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
  const fixer = new PythonFixer(tempFile, messyPython);

  // 3️⃣ Run the fixer
  await fixer.analyze();

  // 4️⃣ Get the fixed code
  const fixedCode = fixer.getFixedCode();

  console.log("\n================ Fixed Python Code ================\n");
  console.log(fixedCode);

  // 5️⃣ Clean up temp file if desired
  // await fs.unlink(tempFile);
}

testPythonFixer().catch((err) => console.error(err));
