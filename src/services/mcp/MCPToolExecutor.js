const {
  MAX_RESULT_TEXT_CHARS,
  safeErrorMessage,
  truncateText
} = require("./types");

let mcpClientManager = null;

function setMcpClientManager(manager) {
  mcpClientManager = manager || null;
}

function getMcpClientManager() {
  return mcpClientManager;
}

async function ensureManager(workspaceRoot) {
  if (!mcpClientManager) {
    throw new Error("MCP client manager is not configured.");
  }

  await mcpClientManager.initialize(workspaceRoot);
  return mcpClientManager;
}

function validateMcpCall(params = {}) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {
      valid: false,
      error: "MCP tool payload must be an object."
    };
  }

  if (!String(params.serverName || "").trim()) {
    return { valid: false, error: "serverName is required." };
  }

  if (!String(params.toolName || "").trim()) {
    return { valid: false, error: "toolName is required." };
  }

  if (
    params.arguments !== undefined &&
    (!params.arguments ||
      typeof params.arguments !== "object" ||
      Array.isArray(params.arguments))
  ) {
    return {
      valid: false,
      error: "arguments must be a JSON object."
    };
  }

  return { valid: true };
}

async function executeMcpTool(params = {}, workspaceRoot, executionContext = {}) {
  const validation = validateMcpCall(params);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const manager = await ensureManager(workspaceRoot);
  const tool = manager.getTool(params.serverName, params.toolName);
  const trustedServer = manager.isServerTrusted?.(params.serverName) === true;
  const risk = assessToolRisk(
    params.serverName,
    tool || { name: params.toolName },
    { trustedServer }
  );

  if (
    risk.requiresConfirmation &&
    executionContext.confirmDangerousMcpAction !== true
  ) {
    const serverLabel = params.serverName;
    const toolLabel = params.toolName;
    throw new Error(
      `Confirmation required before running MCP tool ${serverLabel}.${toolLabel}: ${risk.reason}`
    );
  }

  const rawResult = await manager.callTool(
    params.serverName,
    params.toolName,
    params.arguments || {},
    executionContext
  );
  const formatted = formatToolResult(rawResult);

  return {
    success: rawResult?.isError !== true,
    serverName: params.serverName,
    toolName: params.toolName,
    risk,
    text: formatted.text,
    structuredContent: rawResult?.structuredContent || null,
    content: Array.isArray(rawResult?.content) ? rawResult.content : [],
    rawResult
  };
}

function buildMcpPromptContext(workspaceRoot) {
  if (!mcpClientManager) {
    return "";
  }

  if (workspaceRoot && !mcpClientManager.initialized) {
    return "";
  }

  return mcpClientManager.buildPromptContext();
}

function getMcpUiState() {
  return mcpClientManager ? mcpClientManager.getUiState() : null;
}

function assessToolRisk(serverName, tool = null, options = {}) {
  const annotations = tool?.annotations || {};
  const trustedServer = options.trustedServer === true;
  const lowerServer = String(serverName || "").toLowerCase();

  if (!trustedServer) {
    return {
      requiresConfirmation: true,
      reason:
        `the MCP server ${lowerServer || "unknown"} is not marked trusted; ` +
        "tool annotations are untrusted hints"
    };
  }

  if (annotations.readOnlyHint === true && annotations.destructiveHint !== true) {
    return {
      requiresConfirmation: false,
      reason: ""
    };
  }

  const lowerToolName = String(tool?.name || "").toLowerCase();
  const riskyVerbPattern =
    /(delete|destroy|remove|write|update|create|merge|dispatch|restart|stop|kill|exec|run|push|close|approve|commit|apply|modify|upload|send)/i;

  const isUnknownRisk = annotations.readOnlyHint === undefined && annotations.destructiveHint === undefined;

  const requiresConfirmation =
    annotations.destructiveHint === true ||
    riskyVerbPattern.test(lowerToolName) ||
    isUnknownRisk;

  return {
    requiresConfirmation,
    reason: requiresConfirmation
      ? (isUnknownRisk ? `the tool has unknown risk (no safety annotations)` : `the tool may perform a state-changing action on ${lowerServer || "an MCP server"}`)
      : ""
  };
}

function formatToolResult(rawResult) {
  const lines = [];
  if (Array.isArray(rawResult?.content)) {
    for (const item of rawResult.content) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (item.type === "text" && typeof item.text === "string") {
        lines.push(item.text);
        continue;
      }

      lines.push(JSON.stringify(item, null, 2));
    }
  }

  if (
    rawResult?.structuredContent &&
    (typeof rawResult.structuredContent !== "object" ||
      Object.keys(rawResult.structuredContent).length > 0)
  ) {
    lines.push(JSON.stringify(rawResult.structuredContent, null, 2));
  }

  const text = truncateText(lines.filter(Boolean).join("\n\n"), MAX_RESULT_TEXT_CHARS);
  return {
    text: text || "MCP tool returned no text content."
  };
}

function buildToolTranscript(result) {
  const serverName = result?.serverName || "unknown";
  const toolName = result?.toolName || "unknown";
  const output = truncateText(
    String(result?.text || result?.error || "No output."),
    MAX_RESULT_TEXT_CHARS
  );

  return [
    `MCP_TOOL: ${serverName}.${toolName}`,
    `Success: ${result?.success !== false}`,
    "Output:",
    output
  ].join("\n");
}

module.exports = {
  setMcpClientManager,
  getMcpClientManager,
  validateMcpCall,
  executeMcpTool,
  buildMcpPromptContext,
  getMcpUiState,
  assessToolRisk,
  formatToolResult,
  buildToolTranscript,
  safeErrorMessage
};
