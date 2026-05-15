/**
 * Test tool registry integration
 */

const { registry } = require("./src/ai-agent/tools");

console.log("Testing tool registry integration...\n");

// Check if list_code_definition_names is registered
const tool = registry.getTool("list_code_definition_names");

if (tool) {
  console.log("✓ Tool is registered in the registry");
  console.log("\nTool details:");
  console.log("  Name:", tool.name);
  console.log("  Description:", tool.description);
  console.log("  Parameters:", Object.keys(tool.params));
  console.log("  Has handler:", typeof tool.handler === "function");
  console.log("  Examples:", tool.examples?.length || 0);
} else {
  console.error("✗ Tool is NOT registered in the registry");
  process.exit(1);
}

// List all registered tools
console.log("\n\nAll registered tools:");
const allTools = registry.listTools();
allTools.forEach(t => {
  console.log(`  - ${t.name}: ${t.description.substring(0, 60)}...`);
});

console.log("\n✓ Tool registry integration test passed!");

// Made with Bob
