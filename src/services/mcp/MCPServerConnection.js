const {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RESTART_DELAY_MS,
  DEFAULT_START_TIMEOUT_MS,
  safeErrorMessage
} = require("./types");

class MCPServerConnection {
  constructor(serverConfig, options = {}) {
    this.serverConfig = serverConfig;
    this.name = serverConfig.name;
    this.packageVersion = String(options.packageVersion || "1.0.0");
    this.sdkLoader =
      typeof options.sdkLoader === "function"
        ? options.sdkLoader
        : MCPServerConnection.loadSdk;
    this.logger =
      typeof options.logger === "function" ? options.logger : () => {};
    this.onStateChange =
      typeof options.onStateChange === "function" ? options.onStateChange : () => {};
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

    this.status = serverConfig.enabled ? "stopped" : "disabled";
    this.lastError = "";
    this.tools = [];
    this.instructions = "";
    this.client = null;
    this.transport = null;
    this._pendingClient = null;
    this._pendingTransport = null;
    this._connectAttemptId = null;
    this._restartTimer = null;
    this._restartAttempts = 0;
    this._isStopping = false;
    this._manualStop = false;
  }

  static async loadSdk() {
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/stdio.js")
    ]);

    return { Client, StdioClientTransport };
  }

  snapshot() {
    return {
      name: this.name,
      enabled: this.serverConfig.enabled,
      configuredEnabled: this.serverConfig.configuredEnabled !== false,
      status: this.status,
      toolCount: this.tools.length,
      tools: this.tools.map((tool) => ({ ...tool })),
      lastError: this.lastError,
      restartAttempts: this._restartAttempts,
      instructions: this.instructions,
      commandAvailable: this.serverConfig.commandAvailable !== false,
      autoDisabledReason: this.serverConfig.autoDisabledReason || "",
      command: this.serverConfig.originalCommand || this.serverConfig.command,
      args: [...(this.serverConfig.originalArgs || this.serverConfig.args || [])]
    };
  }

  async start() {
    if (!this.serverConfig.enabled) {
      this._setState("disabled");
      return this.snapshot();
    }

    if (this.status === "connected" && this.client) {
      return this.snapshot();
    }

    this._manualStop = false;
    this._isStopping = false;
    this._clearRestartTimer();
    this._setState("starting");
    const connectAttemptId = Symbol(`mcp-connect-${this.name}`);
    this._connectAttemptId = connectAttemptId;

    try {
      const connected = await this._withTimeout(
        this._connect(connectAttemptId),
        this.startTimeoutMs
      );
      if (!connected) {
        return this.snapshot();
      }
      this._restartAttempts = 0;
      this.lastError = "";
      this._setState("connected");
      this._log("info", "server.connected", {
        toolCount: this.tools.length
      });
      return this.snapshot();
    } catch (error) {
      if (this._connectAttemptId === connectAttemptId) {
        this._connectAttemptId = null;
      }
      this._isStopping = true;
      await this._disposeActiveAndPendingConnections();
      this._isStopping = false;
      this.lastError = this._buildFriendlyStartupError(error);
      this._setState("error");
      this._log("error", "server.start_failed", {
        error: this.lastError
      });
      if (this._shouldRetryStartError(error)) {
        this._scheduleRestart("start_failed");
      }
      throw error;
    }
  }

  async stop(reason = "manual_stop") {
    this._manualStop = reason === "manual_stop" || reason === "shutdown";
    this._isStopping = true;
    this._connectAttemptId = null;
    this._clearRestartTimer();
    await this._disposeActiveAndPendingConnections();

    this._isStopping = false;
    this._setState(this.serverConfig.enabled ? "stopped" : "disabled");
    this._log("info", "server.stopped", { reason });
    return this.snapshot();
  }

  async restart(reason = "manual_restart") {
    await this.stop(reason);
    return this.start();
  }

  async refreshTools() {
    if (!this.client) {
      return [];
    }

    this.tools = await this._listAllTools(this.client);
    this._log("info", "server.tools_refreshed", {
      toolCount: this.tools.length
    });
    this.onStateChange(this.snapshot());
    return this.tools;
  }

  getTool(toolName) {
    return this.tools.find((tool) => tool.name === toolName) || null;
  }

  async callTool(toolName, args = {}, options = {}) {
    if (!this.client || this.status !== "connected") {
      await this.start();
    }

    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : this.callTimeoutMs;
    const result = await this._withTimeout(
      this.client.callTool({
        name: toolName,
        arguments: args
      }),
      timeoutMs
    );

    this._log("info", "tool.called", {
      toolName,
      isError: result?.isError === true
    });

    return result;
  }

  async _connect(connectAttemptId) {
    const { Client, StdioClientTransport } = await this.sdkLoader();
    const client = new Client(
      {
        name: "code-janitor",
        version: this.packageVersion
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      }
    );
    const transport = new StdioClientTransport({
      command: this.serverConfig.command,
      args: this.serverConfig.args,
      env: {
        ...process.env,
        ...this.serverConfig.env
      },
      cwd: this.serverConfig.cwd
    });
    this._pendingClient = client;
    this._pendingTransport = transport;

    client.onerror = (error) => {
      if (this._isStopping) return;
      this.lastError = safeErrorMessage(error);
      this._log("warn", "server.client_error", {
        error: this.lastError
      });
      this._scheduleRestart("client_error");
    };

    client.onclose = () => {
      if (this._isStopping) return;
      this.lastError = this.lastError || "The MCP server connection closed unexpectedly.";
      this._log("warn", "server.closed", {});
      this._setState("error");
      this._scheduleRestart("closed");
    };

    await client.connect(transport);
    const tools = await this._listAllTools(client);

    if (this._connectAttemptId !== connectAttemptId || this._isStopping) {
      this._pendingClient = null;
      this._pendingTransport = null;
      await this._disposeConnectionArtifacts(client, transport);
      return false;
    }

    this.client = client;
    this.transport = transport;
    this._pendingClient = null;
    this._pendingTransport = null;
    this.instructions =
      typeof client.getInstructions === "function"
        ? String(client.getInstructions() || "")
        : "";
    this.tools = tools;
    return true;
  }

  async _listAllTools(client) {
    const allTools = [];
    let cursor;

    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      const tools = Array.isArray(page?.tools) ? page.tools : [];
      allTools.push(...tools.map((tool) => ({ ...tool })));
      cursor = page?.nextCursor;
    } while (cursor);

    return allTools;
  }

  _scheduleRestart(reason) {
    if (this._manualStop || this._isStopping || !this.serverConfig.enabled) {
      return;
    }

    if (this._restartTimer) {
      return;
    }

    if (this._restartAttempts >= this.maxRestartAttempts) {
      this._log("error", "server.restart_abandoned", {
        reason
      });
      return;
    }

    this._restartAttempts += 1;
    this._setState("restarting");
    this._restartTimer = setTimeout(async () => {
      this._restartTimer = null;
      try {
        await this.start();
      } catch (_) {
        this._scheduleRestart("restart_retry_failed");
      }
    }, this.restartDelayMs);

    this._log("warn", "server.restart_scheduled", {
      attempt: this._restartAttempts,
      reason
    });
  }

  _clearRestartTimer() {
    if (!this._restartTimer) {
      return;
    }

    clearTimeout(this._restartTimer);
    this._restartTimer = null;
  }

  _setState(nextState) {
    if (this.status === nextState) {
      return;
    }

    this.status = nextState;
    this.onStateChange(this.snapshot());
  }

  _log(level, event, data = {}) {
    this.logger(level, event, {
      serverName: this.name,
      ...data
    });
  }

  async _disposeActiveAndPendingConnections() {
    const activeClient = this.client;
    const activeTransport = this.transport;
    const pendingClient = this._pendingClient;
    const pendingTransport = this._pendingTransport;

    this.client = null;
    this.transport = null;
    this._pendingClient = null;
    this._pendingTransport = null;

    await this._disposeConnectionArtifacts(activeClient, activeTransport);
    if (
      pendingClient !== activeClient ||
      pendingTransport !== activeTransport
    ) {
      await this._disposeConnectionArtifacts(pendingClient, pendingTransport);
    }
  }

  async _disposeConnectionArtifacts(client, transport) {
    const disposals = [];

    if (client && typeof client.close === "function") {
      disposals.push(
        Promise.resolve()
          .then(() => client.close())
          .catch((error) => {
            this._log("warn", "server.client_close_failed", {
              error: safeErrorMessage(error)
            });
          })
      );
    }

    if (transport && typeof transport.close === "function") {
      disposals.push(
        Promise.resolve()
          .then(() => transport.close())
          .catch((error) => {
            this._log("warn", "server.transport_close_failed", {
              error: safeErrorMessage(error)
            });
          })
      );
    }

    if (disposals.length > 0) {
      await Promise.allSettled(disposals);
    }
  }

  async _withTimeout(promise, timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return promise;
    }

    let timeoutHandle;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`MCP operation timed out after ${timeoutMs}ms.`));
          }, timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  _shouldRetryStartError(error) {
    const code = String(error?.code || "").trim().toUpperCase();
    if (code === "ENOENT") {
      return false;
    }

    const message = safeErrorMessage(error).toLowerCase();
    if (message.includes("spawn") && message.includes("enoent")) {
      return false;
    }

    return true;
  }

  _buildFriendlyStartupError(error) {
    const code = String(error?.code || "").trim().toUpperCase();
    const command =
      this.serverConfig.originalCommand || this.serverConfig.command || "unknown";

    if (code === "ENOENT") {
      return `Command not found on PATH: ${command}. Install it or disable the "${this.name}" MCP server in mcp.config.json.`;
    }

    const message = safeErrorMessage(error);
    if (/\bspawn\b/i.test(message) && /\bENOENT\b/i.test(message)) {
      return `Command not found on PATH: ${command}. Install it or disable the "${this.name}" MCP server in mcp.config.json.`;
    }

    return message;
  }
}

module.exports = MCPServerConnection;
