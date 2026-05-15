/**
 * tool-registry.js
 * 
 * Central registry for all Bob-style tools.
 * Manages tool definitions, validation, and execution.
 */

const { applyDiff, validateDiff } = require("./apply-diff");
const { insertContent, validateInsert } = require("./insert-content");
const { readFiles, formatResults } = require("./read-file");
const { updateTodoList, MAX_TODO_ITEMS } = require("./update-todo-list");

/**
 * Tool definitions with metadata
 */
const TOOL_DEFINITIONS = {
  apply_diff: {
    name: "apply_diff",
    description: "Apply SEARCH/REPLACE diff blocks to a file for surgical edits",
    handler: applyDiff,
    validator: validateDiff,
    params: {
      path: { type: "string", required: true, description: "File path relative to workspace" },
      diff: { type: "string", required: true, description: "SEARCH/REPLACE diff blocks" }
    },
    examples: [
      {
        description: "Single diff block",
        usage: `apply_diff('src/app.js', \`
:start_line: 10
-------
function oldName() {
  return 42;
}
function newName() {
  return 42;
}
\`)`
      },
      {
        description: "Multiple diff blocks",
        usage: `apply_diff('src/app.js', \`
:start_line: 10
-------
const x = 1;
const x = 2;

:start_line: 20
-------
const y = 3;
const y = 4;
\`)`
      }
    ]
  },
  
  insert_content: {
    name: "insert_content",
    description: "Insert lines of content at a specific line number or append to end",
    handler: insertContent,
    validator: validateInsert,
    params: {
      path: { type: "string", required: true, description: "File path relative to workspace" },
      line: { type: "number", required: true, description: "Line number (1-based) or 0 to append" },
      content: { type: "string", required: true, description: "Content to insert" }
    },
    examples: [
      {
        description: "Insert at beginning",
        usage: "insert_content('src/app.js', 1, '// New comment at top')"
      },
      {
        description: "Append to end",
        usage: "insert_content('src/app.js', 0, '\\n// End of file')"
      },
      {
        description: "Insert multiple lines",
        usage: `insert_content('src/app.js', 10, \`
// Multi-line comment
// explaining the code below
\`)`
      }
    ]
  },
  
  read_file: {
    name: "read_file",
    description: "Read one or more files with optional line ranges (max 5 files)",
    handler: async (fileSpecs, workspaceRoot) => {
      const results = await readFiles(fileSpecs, workspaceRoot);
      return formatResults(results);
    },
    params: {
      files: {
        type: "array",
        required: true,
        description: "Array of file specs: [{ path: string, lineRanges?: string[] }]",
        maxItems: 5
      }
    },
    examples: [
      {
        description: "Read single file",
        usage: "read_file([{ path: 'src/app.js' }])"
      },
      {
        description: "Read with line ranges",
        usage: "read_file([{ path: 'src/app.js', lineRanges: ['1-50', '100-150'] }])"
      },
      {
        description: "Read multiple files",
        usage: `read_file([
  { path: 'src/app.js', lineRanges: ['1-100'] },
  { path: 'src/utils.js', lineRanges: ['50-75'] },
  { path: 'package.json' }
])`
      }
    ]
  },

  update_todo_list: {
    name: "update_todo_list",
    description:
      "Replace the current chat session todo list with tracked task statuses",
    handler: updateTodoList,
    params: {
      items: {
        type: "array",
        required: true,
        description:
          "Array of todo items: [{ text: string, status: 'pending' | 'in_progress' | 'completed' }]",
        maxItems: MAX_TODO_ITEMS
      }
    },
    examples: [
      {
        description: "Track a short multi-step task",
        usage: `update_todo_list([
  { text: 'Inspect the current tool wiring', status: 'completed' },
  { text: 'Add todo list persistence', status: 'in_progress' },
  { text: 'Run targeted tests', status: 'pending' }
])`
      },
      {
        description: "Clear the todo list",
        usage: "update_todo_list([])"
      }
    ]
  }
};

/**
 * Tool registry class
 */
class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.executionHistory = [];
    this.maxHistorySize = 100;
    
    // Register all tools
    Object.values(TOOL_DEFINITIONS).forEach(tool => {
      this.registerTool(tool);
    });
  }
  
  /**
   * Register a new tool
   */
  registerTool(toolDef) {
    if (!toolDef.name || !toolDef.handler) {
      throw new Error("Tool must have name and handler");
    }
    
    this.tools.set(toolDef.name, toolDef);
  }
  
  /**
   * Get tool definition
   */
  getTool(name) {
    return this.tools.get(name);
  }
  
  /**
   * List all available tools
   */
  listTools() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      params: tool.params
    }));
  }
  
  /**
   * Validate tool parameters
   */
  validateParams(toolName, params) {
    const tool = this.getTool(toolName);
    if (!tool) {
      return { valid: false, error: `Unknown tool: ${toolName}` };
    }
    
    const errors = [];
    
    // Check required params
    for (const [paramName, paramDef] of Object.entries(tool.params)) {
      if (paramDef.required && !(paramName in params)) {
        errors.push(`Missing required parameter: ${paramName}`);
      }
      
      if (paramName in params) {
        const value = params[paramName];
        const actualType = Array.isArray(value) ? "array" : typeof value;
        
        if (actualType !== paramDef.type) {
          errors.push(
            `Parameter ${paramName} has wrong type. Expected ${paramDef.type}, got ${actualType}`
          );
        }
        
        // Check array constraints
        if (paramDef.type === "array" && paramDef.maxItems && value.length > paramDef.maxItems) {
          errors.push(
            `Parameter ${paramName} exceeds maximum items (${paramDef.maxItems}). Got ${value.length} items.`
          );
        }
      }
    }
    
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    return { valid: true };
  }
  
  /**
   * Execute a tool
   */
  async executeTool(toolName, params, workspaceRoot, executionContext = {}) {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    
    // Validate parameters
    const validation = this.validateParams(toolName, params);
    if (!validation.valid) {
      throw new Error(`Invalid parameters: ${validation.errors?.join(", ") || validation.error}`);
    }
    
    // Execute tool
    const startTime = Date.now();
    let result;
    let error;
    
    try {
      // Call handler with appropriate parameters
      if (toolName === "read_file") {
        result = await tool.handler(params.files, workspaceRoot, executionContext);
      } else if (toolName === "insert_content") {
        result = await tool.handler(
          params.path,
          params.line,
          params.content,
          workspaceRoot,
          executionContext
        );
      } else if (toolName === "apply_diff") {
        result = await tool.handler(
          params.path,
          params.diff,
          workspaceRoot,
          executionContext
        );
      } else if (toolName === "update_todo_list") {
        result = await tool.handler(params.items, workspaceRoot, executionContext);
      } else {
        result = await tool.handler(params, workspaceRoot, executionContext);
      }
    } catch (err) {
      error = err.message;
      throw err;
    } finally {
      // Record execution
      const execution = {
        tool: toolName,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        success: !error,
        error: error,
        params: this._sanitizeParams(params)
      };
      
      this.executionHistory.push(execution);
      
      // Trim history if needed
      if (this.executionHistory.length > this.maxHistorySize) {
        this.executionHistory.shift();
      }
    }
    
    return result;
  }
  
  /**
   * Get execution statistics
   */
  getStats() {
    const stats = {
      totalExecutions: this.executionHistory.length,
      byTool: {},
      successRate: 0,
      averageDuration: 0
    };
    
    let totalDuration = 0;
    let successCount = 0;
    
    for (const execution of this.executionHistory) {
      // By tool stats
      if (!stats.byTool[execution.tool]) {
        stats.byTool[execution.tool] = {
          count: 0,
          successes: 0,
          failures: 0,
          avgDuration: 0
        };
      }
      
      const toolStats = stats.byTool[execution.tool];
      toolStats.count++;
      
      if (execution.success) {
        toolStats.successes++;
        successCount++;
      } else {
        toolStats.failures++;
      }
      
      totalDuration += execution.duration;
    }
    
    // Calculate averages
    if (this.executionHistory.length > 0) {
      stats.successRate = (successCount / this.executionHistory.length) * 100;
      stats.averageDuration = totalDuration / this.executionHistory.length;
      
      for (const toolName in stats.byTool) {
        const toolStats = stats.byTool[toolName];
        const toolExecutions = this.executionHistory.filter(e => e.tool === toolName);
        const toolDuration = toolExecutions.reduce((sum, e) => sum + e.duration, 0);
        toolStats.avgDuration = toolDuration / toolExecutions.length;
      }
    }
    
    return stats;
  }
  
  /**
   * Get recent execution history
   */
  getHistory(limit = 10) {
    return this.executionHistory.slice(-limit).reverse();
  }
  
  /**
   * Clear execution history
   */
  clearHistory() {
    this.executionHistory = [];
  }
  
  /**
   * Sanitize parameters for logging (remove large content)
   */
  _sanitizeParams(params) {
    const sanitized = { ...params };
    
    if (sanitized.content && sanitized.content.length > 100) {
      sanitized.content = sanitized.content.substring(0, 100) + "... [truncated]";
    }
    
    if (sanitized.diff && sanitized.diff.length > 200) {
      sanitized.diff = sanitized.diff.substring(0, 200) + "... [truncated]";
    }
    
    return sanitized;
  }
  
  /**
   * Get tool help text
   */
  getHelp(toolName) {
    const tool = this.getTool(toolName);
    if (!tool) {
      return `Unknown tool: ${toolName}`;
    }
    
    const lines = [];
    lines.push(`# ${tool.name}`);
    lines.push("");
    lines.push(tool.description);
    lines.push("");
    lines.push("## Parameters");
    
    for (const [paramName, paramDef] of Object.entries(tool.params)) {
      const required = paramDef.required ? " (required)" : " (optional)";
      lines.push(`- **${paramName}**${required}: ${paramDef.description}`);
      lines.push(`  Type: ${paramDef.type}`);
      if (paramDef.maxItems) {
        lines.push(`  Max items: ${paramDef.maxItems}`);
      }
    }
    
    if (tool.examples && tool.examples.length > 0) {
      lines.push("");
      lines.push("## Examples");
      
      for (const example of tool.examples) {
        lines.push("");
        lines.push(`### ${example.description}`);
        lines.push("```javascript");
        lines.push(example.usage);
        lines.push("```");
      }
    }
    
    return lines.join("\n");
  }
}

// Create singleton instance
const registry = new ToolRegistry();

module.exports = {
  registry,
  ToolRegistry,
  TOOL_DEFINITIONS
};

// Made with Bob
