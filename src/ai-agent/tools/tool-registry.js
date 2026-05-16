/**
 * tool-registry.js
 * 
 * Central registry for structured Code Janitor tools.
 * Manages tool definitions, validation, and execution.
 */

const { applyDiff, validateDiff } = require("./apply-diff");
const { insertContent, validateInsert } = require("./insert-content");
const { readFiles, formatResults } = require("./read-file");
const { listCodeDefinitionNames } = require("./list-code-definition-names");
const { updateTodoList, MAX_TODO_ITEMS } = require("./update-todo-list");
const { askFollowupQuestion, MAX_SUGGESTIONS } = require("./ask-followup-question");
const { attemptCompletion, validateAttemptCompletion } = require("./attempt-completion");
const { submitReviewFindings, validateIssues, MAX_ISSUES_PER_SUBMISSION } = require("./submit-review-findings");
const { fetchGitHubContext } = require("./fetch-github-context");
const { generateEdgeCases, validateEdgeCaseRequest } = require("./generate-edge-cases");
const { executeTests, validateTestRequest } = require("./execute-tests");
const { generateDocumentation, validateDocumentationRequest } = require("./generate-documentation");

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
<<<<<<< SEARCH
:start_line: 10
-------
function oldName() {
  return 42;
}
=======
function newName() {
  return 42;
}
>>>>>>> REPLACE
\`)`
      },
      {
        description: "Multiple diff blocks",
        usage: `apply_diff('src/app.js', \`
<<<<<<< SEARCH
:start_line: 10
-------
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line: 20
-------
const y = 3;
=======
const y = 4;
>>>>>>> REPLACE
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

  list_code_definition_names: {
    name: "list_code_definition_names",
    description: "List definition names (classes, functions, methods, etc.) from source code files using AST analysis",
    handler: listCodeDefinitionNames,
    params: {
      path: {
        type: "string",
        required: true,
        description: "File path or directory path (relative to workspace). For directories, analyzes all top-level source files."
      }
    },
    examples: [
      {
        description: "List definitions from a specific file",
        usage: "list_code_definition_names('src/main.ts')"
      },
      {
        description: "List definitions from all files in a directory",
        usage: "list_code_definition_names('src/')"
      },
      {
        description: "Analyze a Python file",
        usage: "list_code_definition_names('app.py')"
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
  },

  ask_followup_question: {
    name: "ask_followup_question",
    description:
      "Ask the user a question to gather additional information with suggested answers",
    handler: askFollowupQuestion,
    params: {
      question: {
        type: "string",
        required: true,
        description: "The question to ask the user"
      },
      suggestions: {
        type: "array",
        required: true,
        description:
          "Array of suggested answers: [{ text: string, mode?: string }]",
        maxItems: MAX_SUGGESTIONS
      }
    },
    examples: [
      {
        description: "Ask a simple question with suggestions",
        usage: `ask_followup_question({
  question: 'Which file should I modify?',
  suggestions: [
    { text: 'src/app.js' },
    { text: 'src/utils.js' },
    { text: 'src/config.js' }
  ]
})`
      },
      {
        description: "Ask with mode-switching suggestions",
        usage: `ask_followup_question({
  question: 'How would you like to proceed?',
  suggestions: [
    { text: 'Review the code first', mode: 'ask' },
    { text: 'Make the changes now', mode: 'code' },
    { text: 'Create a plan', mode: 'plan' }
  ]
})`
      }
    ]
  },

  attempt_completion: {
    name: "attempt_completion",
    description:
      "Present the final result of a task to the user. MUST only be used after confirming all previous tool uses were successful.",
    handler: attemptCompletion,
    validator: validateAttemptCompletion,
    params: {
      result: {
        type: "string",
        required: true,
        description: "The final result description. Must be concise, final, and not end with questions or offers for further assistance."
      }
    },
    examples: [
      {
        description: "Complete a task with a concise result",
        usage: `attempt_completion({
  result: '- CSS update complete\\n- Documented changes\\n- Navigation menu redesigned for better accessibility'
})`
      },
      {
        description: "Complete with a simple statement",
        usage: `attempt_completion({
  result: 'Task complete. All files updated successfully.'
})`
      }
    ]
  },

  submit_review_findings: {
    name: "submit_review_findings",
    description: "Create multiple formal review issues in a single call that will appear in the Code Janitor review findings flow",
    handler: submitReviewFindings,
    validator: validateIssues,
    params: {
      issues: {
        type: "array",
        required: true,
        description: "Array of issue objects with category, type, severity, title, message, path, line, issueScope, and optional column, endLine, endColumn, suggestion",
        maxItems: MAX_ISSUES_PER_SUBMISSION
      }
    },
    examples: [
      {
        description: "Submit multiple review findings",
        usage: `submit_review_findings([
  {
    category: "maintainability",
    type: "magic-numbers-strings",
    severity: "medium",
    title: "Magic number should be constant",
    message: "The magic number 42 should be extracted to a named constant",
    path: "src/utils/calculator.ts",
    line: 15,
    column: 4,
    endLine: 16,
    endColumn: 5,
    issueScope: "Single File"
  },
  {
    category: "security",
    type: "sensitive-data-logging",
    severity: "critical",
    title: "Hardcoded API key",
    message: "API key hardcoded in source code",
    path: "src/config/api.ts",
    line: 8,
    suggestion: "Move to environment variables",
    issueScope: "Single File"
  }
])`
      }
    ]
  },

  fetch_github_context: {
    name: "fetch_github_context",
    description: "Fetch GitHub repository, issue, or pull request context using the current workspace origin remote by default",
    handler: fetchGitHubContext,
    params: {
      mode: {
        type: "string",
        required: true,
        description: "GitHub context mode: repo, issue, or pull_request"
      },
      owner: {
        type: "string",
        required: false,
        description: "Repository owner or organization. Optional when the current workspace origin remote is a GitHub repository."
      },
      repo: {
        type: "string",
        required: false,
        description: "Repository name. Optional when the current workspace origin remote is a GitHub repository."
      },
      number: {
        type: "number",
        required: false,
        description: "Issue or pull request number. Required for issue and pull_request modes."
      }
    },
    examples: [
      {
        description: "Summarize the current workspace GitHub repository",
        usage: `fetch_github_context({
  mode: "repo"
})`
      },
      {
        description: "Fetch a specific GitHub issue",
        usage: `fetch_github_context({
  mode: "issue",
  owner: "octocat",
  repo: "Hello-World",
  number: 42
})`
      },
      {
        description: "Fetch a specific pull request",
        usage: `fetch_github_context({
  mode: "pull_request",
  owner: "octocat",
  repo: "Hello-World",
  number: 108
})`
      }
    ]
  },

  generate_edge_cases: {
    name: "generate_edge_cases",
    description: "Generate comprehensive edge cases for testing code functions and classes",
    handler: generateEdgeCases,
    validator: validateEdgeCaseRequest,
    params: {
      filePath: {
        type: "string",
        required: true,
        description: "Path to the source file to generate edge cases for"
      }
    },
    examples: [
      {
        description: "Generate edge cases for a JavaScript file",
        usage: `generate_edge_cases({
  filePath: 'src/utils/calculator.js'
})`
      },
      {
        description: "Generate edge cases for a Python file",
        usage: `generate_edge_cases({
  filePath: 'app/models/user.py'
})`
      }
    ]
  },

  execute_tests: {
    name: "execute_tests",
    description: "Execute tests and generate comprehensive test reports with edge case coverage",
    handler: executeTests,
    validator: validateTestRequest,
    params: {
      testPath: {
        type: "string",
        required: false,
        description: "Path to specific test file or directory. If not provided, runs all tests."
      },
      framework: {
        type: "string",
        required: false,
        description: "Test framework to use (jest, mocha, pytest, junit). Auto-detected if not specified."
      },
      generateReport: {
        type: "boolean",
        required: false,
        description: "Whether to generate a detailed test report (default: true)"
      },
      includeEdgeCases: {
        type: "boolean",
        required: false,
        description: "Whether to include edge case tests in execution (default: true)"
      }
    },
    examples: [
      {
        description: "Run all tests with report generation",
        usage: `execute_tests({
  generateReport: true,
  includeEdgeCases: true
})`
      },
      {
        description: "Run specific test file",
        usage: `execute_tests({
  testPath: 'src/__tests__/calculator.test.js',
  framework: 'jest'
})`
      }
    ]
  },

  generate_documentation: {
    name: "generate_documentation",
    description: "Generate comprehensive documentation for a repository including README, API docs, and contributing guides",
    handler: generateDocumentation,
    validator: validateDocumentationRequest,
    params: {
      type: {
        type: "string",
        required: false,
        description: "Documentation type: 'readme', 'api', 'contributing', or 'full' (default: 'readme')"
      },
      outputPath: {
        type: "string",
        required: false,
        description: "Custom output path for the documentation. Auto-generated if not specified."
      },
      includeApi: {
        type: "boolean",
        required: false,
        description: "Include API documentation (default: true)"
      },
      includeExamples: {
        type: "boolean",
        required: false,
        description: "Include code examples in documentation (default: true)"
      },
      scanDirectory: {
        type: "string",
        required: false,
        description: "Directory to scan for code analysis (default: 'src')"
      }
    },
    examples: [
      {
        description: "Generate README documentation",
        usage: `generate_documentation({
  type: 'readme',
  includeApi: true,
  includeExamples: true
})`
      },
      {
        description: "Generate full documentation suite",
        usage: `generate_documentation({
  type: 'full',
  scanDirectory: 'src'
})`
      },
      {
        description: "Generate API documentation only",
        usage: `generate_documentation({
  type: 'api',
  outputPath: 'docs/API.md',
  includeExamples: true
})`
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

  _normalizeValidatorResult(validationResult) {
    if (!validationResult || typeof validationResult !== "object") {
      return { valid: true };
    }

    if (validationResult.valid === true || validationResult.isValid === true) {
      return { valid: true };
    }

    if (validationResult.valid === false || validationResult.isValid === false) {
      return {
        valid: false,
        error:
          validationResult.error ||
          validationResult.errors?.join(", ") ||
          "Validation failed"
      };
    }

    return { valid: true };
  }

  async validateToolExecution(toolName, params, workspaceRoot) {
    const tool = this.getTool(toolName);
    if (!tool || typeof tool.validator !== "function") {
      return { valid: true };
    }

    let validationResult;

    if (toolName === "apply_diff") {
      validationResult = tool.validator(params.diff);
    } else if (toolName === "insert_content") {
      validationResult = await tool.validator(params.path, params.line, workspaceRoot);
    } else if (toolName === "attempt_completion") {
      validationResult = tool.validator(params);
    } else if (toolName === "submit_review_findings") {
      validationResult = tool.validator(params.issues);
    } else {
      validationResult = await tool.validator(params, workspaceRoot);
    }

    return this._normalizeValidatorResult(validationResult);
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

    const toolValidation = await this.validateToolExecution(
      toolName,
      params,
      workspaceRoot
    );
    if (!toolValidation.valid) {
      throw new Error(`Invalid ${toolName} payload: ${toolValidation.error}`);
    }
    
    // Execute tool
    const startTime = Date.now();
    let result;
    let error;
    
    try {
      // Call handler with appropriate parameters
      if (toolName === "read_file") {
        result = await tool.handler(params.files, workspaceRoot, executionContext);
      } else if (toolName === "list_code_definition_names") {
        result = await tool.handler(params.path, workspaceRoot, executionContext);
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
      } else if (toolName === "ask_followup_question") {
        result = await tool.handler(params, workspaceRoot, executionContext);
      } else if (toolName === "attempt_completion") {
        result = await tool.handler(params, workspaceRoot, executionContext);
      } else if (toolName === "submit_review_findings") {
        result = await tool.handler(params.issues, workspaceRoot, executionContext);
      } else if (toolName === "generate_edge_cases") {
        result = await tool.handler(params.filePath, workspaceRoot, executionContext);
      } else if (toolName === "execute_tests") {
        result = await tool.handler(params, workspaceRoot, executionContext);
      } else if (toolName === "generate_documentation") {
        result = await tool.handler(params, workspaceRoot, executionContext);
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
