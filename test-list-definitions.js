/**
 * Manual test for list-code-definition-names tool
 */

const { listCodeDefinitionNames } = require("./src/ai-agent/tools/list-code-definition-names");
const path = require("path");

async function runTests() {
  console.log("Testing list-code-definition-names tool...\n");
  
  const workspaceRoot = __dirname;
  
  // Test 1: Analyze a JavaScript file
  console.log("Test 1: Analyzing a JavaScript file");
  try {
    const result = await listCodeDefinitionNames(
      "src/ai-agent/tools/list-code-definition-names.js",
      workspaceRoot
    );
    console.log("✓ JavaScript file analysis successful");
    console.log(result.substring(0, 500) + "...\n");
  } catch (error) {
    console.error("✗ JavaScript file analysis failed:", error.message);
  }
  
  // Test 2: Analyze a directory
  console.log("Test 2: Analyzing a directory");
  try {
    const result = await listCodeDefinitionNames(
      "src/ai-agent/tools",
      workspaceRoot
    );
    console.log("✓ Directory analysis successful");
    console.log(result.substring(0, 500) + "...\n");
  } catch (error) {
    console.error("✗ Directory analysis failed:", error.message);
  }
  
  // Test 3: Test with non-existent file
  console.log("Test 3: Testing error handling with non-existent file");
  try {
    await listCodeDefinitionNames(
      "nonexistent-file.js",
      workspaceRoot
    );
    console.error("✗ Should have thrown an error");
  } catch (error) {
    console.log("✓ Error handling works correctly:", error.message, "\n");
  }
  
  // Test 4: Analyze tool-registry.js (should find many definitions)
  console.log("Test 4: Analyzing tool-registry.js");
  try {
    const result = await listCodeDefinitionNames(
      "src/ai-agent/tools/tool-registry.js",
      workspaceRoot
    );
    console.log("✓ Tool registry analysis successful");
    
    // Check if it found the ToolRegistry class
    if (result.includes("ToolRegistry")) {
      console.log("✓ Found ToolRegistry class");
    } else {
      console.log("✗ Did not find ToolRegistry class");
    }
    
    // Check if it found methods
    if (result.includes("method")) {
      console.log("✓ Found methods");
    } else {
      console.log("✗ Did not find methods");
    }
    
    console.log("\nSample output:");
    console.log(result.substring(0, 800) + "...\n");
  } catch (error) {
    console.error("✗ Tool registry analysis failed:", error.message);
  }
  
  console.log("\n=== All tests completed ===");
}

runTests().catch(console.error);

// Made with Bob
