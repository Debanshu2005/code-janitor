/**
 * Test tool execution through registry
 */

const { registry } = require("./src/ai-agent/tools");
const path = require("path");

async function testExecution() {
  console.log("Testing tool execution through registry...\n");
  
  const workspaceRoot = __dirname;
  
  try {
    // Test executing the tool through the registry
    console.log("Executing list_code_definition_names through registry...");
    const result = await registry.executeTool(
      "list_code_definition_names",
      { path: "src/ai-agent/tools/attempt-completion.js" },
      workspaceRoot
    );
    
    console.log("✓ Tool executed successfully through registry\n");
    console.log("Result preview:");
    console.log(result.substring(0, 600) + "...\n");
    
    // Check registry stats
    const stats = registry.getStats();
    console.log("Registry execution stats:");
    console.log("  Total executions:", stats.totalExecutions);
    console.log("  Success rate:", stats.successRate.toFixed(2) + "%");
    console.log("  Average duration:", stats.averageDuration.toFixed(2) + "ms");
    
    if (stats.byTool.list_code_definition_names) {
      console.log("\nlist_code_definition_names stats:");
      console.log("  Executions:", stats.byTool.list_code_definition_names.count);
      console.log("  Successes:", stats.byTool.list_code_definition_names.successes);
      console.log("  Failures:", stats.byTool.list_code_definition_names.failures);
    }
    
    console.log("\n✓ All execution tests passed!");
    
  } catch (error) {
    console.error("✗ Tool execution failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testExecution();

// Made with Bob
