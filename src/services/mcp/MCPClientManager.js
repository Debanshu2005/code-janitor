const EventEmitter = require("events");
const path = require("path");
const MCPConfigLoader = require("./MCPConfigLoader");
const MCPServerConnection = require("./MCPServerConnection");
const {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RESTART_DELAY_MS,
  DEFAULT_START_TIMEOUT_MS,
  MCP_CONFIG_FILE,
  safeErrorMessage,
  truncateText
} = require("./types");

class MCPClientManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.configLoader = options.configLoader || new MCPConfigLoader();
    this.connectionFactory =
      typeof options.connectionFactory === "function"
        ? options.connectionFactory
        : (serverConfig, connectionOptions) =>
            new MCPServerConnection(serverConfig, connectionOptions);
    this.packageVersion = String(options.packageVersion || "1.0.0");
    this.logger =
      typeof options.logger === "function" ? options.logger : defaultLogger;
    this.sdkLoader = options.sdkLoader;
    this.startTimeoutMs = Number.isFinite(options.startTimeoutMs)
      ? options.startTimeoutMs
      : DEFAULT_START_TIMEOUT_MS;
    this.callTimeoutMs = Number.isFinite(options.callTimeoutMs)
      ? options.callTimeoutMs
      : DEFAULT_CALL_TIMEOUT_MS;
    this.restartDelayMs = Number.isFinite(options.restartDelayMs)
      ? options.restartDelayMs
      : DEFAULT_RESTART_DELAY_MS;
    this.maxRestartAttempts = Number.isFinite(options.maxRestartAttempts)
      ? options.maxRestartAttempts
      : 3;

    this.workspaceRoot = "";
    this.configPath = "";
    this.configText = "";
    this.rawConfig = null;
    this.connections = new Map();
    this.initialized = false;
    this._initializationPromise = null;
    this._initializingWorkspaceRoot = "";
  }

  async initialize(workspaceRoot) {
    if (!workspaceRoot) {
      throw new Error("Open a workspace folder before initializing MCP.");
    }

    const normalizedRoot = path.resolve(workspaceRoot);
    if (
      this._initializationPromise &&
      this._initializingWorkspaceRoot === normalizedRoot
    ) {
      return this._initializationPromise;
    }

    if (this.initialized && this.workspaceRoot === normalizedRoot) {
      return this.getUiState();
    }

    if (this._initializationPromise) {
      try {
        await this._initializationPromise;
      } catch (_) {
        // Ignore the earlier failure and continue with the requested workspace.
      }

      if (this.initialized && this.workspaceRoot === normalizedRoot) {
        return this.getUiState();
      }
    }

    const initializationPromise = this._performInitialize(normalizedRoot);
    this._initializingWorkspaceRoot = normalizedRoot;
    let wrappedInitializationPromise;
    wrappedInitializationPromise = initializationPromise.finally(() => {
      if (this._initializationPromise === wrappedInitializationPromise) {
        this._initializationPromise = null;
        this._initializingWorkspaceRoot = "";
      }
    });
    this._initializationPromise = wrappedInitializationPromise;
    return wrappedInitializationPromise;
  }

  async _performInitialize(normalizedRoot) {
    await this.shutdown();
    this.workspaceRoot = normalizedRoot;

    const loaded = await this.configLoader.load(normalizedRoot);
    this.configPath = loaded.configPath;
    this.configText = loaded.rawText;
    this.rawConfig = loaded.rawConfig;

    for (const serverConfig of loaded.servers) {
      const connection = this.connectionFactory(serverConfig, {
        packageVersion: this.packageVersion,
        sdkLoader: this.sdkLoader,
        logger: (level, event, data) => this._log(level, event, data),
        onStateChange: () => this.emit("change", this.getUiState()),
        startTimeoutMs: this.startTimeoutMs,
        callTimeoutMs: this.callTimeoutMs,
        restartDelayMs: this.restartDelayMs,
        maxRestartAttempts: this.maxRestartAttempts
      });
      this.connections.set(serverConfig.name, connection);
    }

    await Promise.allSettled(
      [...this.connections.values()]
        .filter((connection) => connection.serverConfig.enabled)
        .map((connection) => connection.start())
    );

    this.initialized = true;
    this.emit("change", this.getUiState());
    this._log("info", "manager.initialized", {
      workspaceRoot: normalizedRoot,
      serverCount: this.connections.size
    });
    return this.getUiState();
  }

  async shutdown() {
    const connections = [...this.connections.values()];
    this.connections.clear();
    this.initialized = false;

    await Promise.allSettled(
      connections.map((connection) => connection.stop("shutdown"))
    );

    this.emit("change", this.getUiState());
  }

  async reload() {
    if (!this.workspaceRoot) {
      throw new Error("No MCP workspace root is active.");
    }
    return this.initialize(this.workspaceRoot);
  }

  listServers() {
    return [...this.connections.values()]
      .map((connection) => connection.snapshot())
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  listTools() {
    const tools = [];
    for (const connection of this.connections.values()) {
      if (connection.status !== "connected") {
        continue;
      }

      for (const tool of connection.tools) {
        tools.push({
          serverName: connection.name,
          ...tool
        });
      }
    }

    return tools.sort((a, b) => {
      if (a.serverName !== b.serverName) {
        return a.serverName.localeCompare(b.serverName);
      }
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  getTool(serverName, toolName) {
    const connection = this.connections.get(serverName);
    if (!connection) {
      return null;
    }
    return connection.getTool(toolName);
  }

  isServerTrusted(serverName) {
    const connection = this.connections.get(serverName);
    return connection?.serverConfig?.trusted === true;
  }

  async callTool(serverName, toolName, args = {}, options = {}) {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`Unknown MCP server "${serverName}".`);
    }

    if (!connection.serverConfig.enabled) {
      throw new Error(`MCP server "${serverName}" is disabled.`);
    }

    const result = await connection.callTool(toolName, args, {
      timeoutMs: Number.isFinite(options.timeoutMs)
        ? options.timeoutMs
        : this.callTimeoutMs
    });

    this.emit("change", this.getUiState());
    return result;
  }

  async restartServer(serverName) {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`Unknown MCP server "${serverName}".`);
    }

    const snapshot = await connection.restart("manual_restart");
    this.emit("change", this.getUiState());
    return snapshot;
  }

  async saveConfig(configInput) {
    if (!this.workspaceRoot) {
      throw new Error("Open a workspace folder before saving MCP config.");
    }

    const saved = await this.configLoader.save(this.workspaceRoot, configInput);
    this.configPath = saved.configPath;
    this.configText = saved.rawText;
    await this.reload();
    return this.getUiState();
  }

  getUiState() {
    return {
      workspaceRoot: this.workspaceRoot,
      configPath:
        this.configPath ||
        (this.workspaceRoot ? path.join(this.workspaceRoot, MCP_CONFIG_FILE) : ""),
      configText: this.configText,
      servers: this.listServers(),
      tools: this.listTools()
    };
  }

  buildPromptContext() {
    const connectedServers = this.listServers().filter(
      (server) => server.status === "connected"
    );
    if (connectedServers.length === 0) {
      return "";
    }

    const lines = [
      "MCP tools are available for external actions.",
      "When you need MCP output, emit only MCP_TOOL actions for that step. After those tool results come back, continue from that evidence.",
      "Format:",
      "MCP_TOOL:",
      "```json",
      "{ \"server\": \"filesystem\", \"tool\": \"read_file\", \"arguments\": { \"path\": \"src/extension.js\" } }",
      "```",
      "Rules:",
      "- Only call the tools listed below.",
      "- Filesystem MCP access is restricted to the current workspace.",
      "- MCP tools from untrusted servers or tools with state-changing risk require user confirmation before execution.",
      "- Tool annotations are hints; only trusted servers can use read-only annotations to skip confirmation.",
      "",
      "Available MCP servers and tools:"
    ];

    let renderedToolCount = 0;
    for (const server of connectedServers) {
      const trustText = this.isServerTrusted(server.name) ? "trusted" : "untrusted";
      lines.push(`- ${server.name}: ${server.toolCount} tool(s), ${trustText}`);
      if (server.instructions) {
        lines.push(`  Server notes: ${truncateText(server.instructions, 220)}`);
      }

      const tools = this.listTools().filter(
        (tool) => tool.serverName === server.name
      );
      for (const tool of tools) {
        if (renderedToolCount >= 40) {
          lines.push("- Additional MCP tools were omitted for brevity.");
          return lines.join("\n");
        }

        const riskFlags = [];
        if (tool.annotations?.readOnlyHint === true) {
          riskFlags.push("read-only");
        }
        if (tool.annotations?.destructiveHint === true) {
          riskFlags.push("destructive");
        }
        if (tool.annotations?.openWorldHint === true) {
          riskFlags.push("open-world");
        }

        const riskText =
          riskFlags.length > 0 ? ` [${riskFlags.join(", ")}]` : "";
        lines.push(
          `  - ${tool.name}${riskText}: ${truncateText(tool.description, 180)}`
        );
        renderedToolCount += 1;
      }
    }

    return lines.join("\n");
  }

  _log(level, event, data = {}) {
    this.logger(level, event, sanitizeLogPayload(data));
  }
}

function sanitizeLogPayload(payload = {}) {
  const json = JSON.stringify(payload, (key, value) => {
    if (/token|secret|password|authorization|api[_-]?key|env/i.test(key)) {
      return "[redacted]";
    }
    return value;
  });

  try {
    return JSON.parse(json);
  } catch (error) {
    return {
      error: safeErrorMessage(error)
    };
  }
}

function defaultLogger(level, event, data = {}) {
  const entry = {
    scope: "mcp",
    level,
    event,
    ...data
  };

  console.log(JSON.stringify(entry));
}

module.exports = MCPClientManager;
