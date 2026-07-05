const fsSync = require("fs");
const fs = require("fs").promises;
const path = require("path");
const {
  MCP_CONFIG_FILE,
  normalizeJsonObject
} = require("./types");

class MCPConfigLoader {
  constructor(options = {}) {
    this.fs = options.fs || fs;
    this.path = options.path || path;
    this.commandExists =
      typeof options.commandExists === "function"
        ? options.commandExists
        : (command) =>
            commandExistsOnPath(command, {
              fs: fsSync,
              path: this.path,
              env: process.env,
              platform: process.platform
            });
  }

  getConfigPath(workspaceRoot) {
    if (!workspaceRoot) {
      throw new Error("A workspace root is required to resolve mcp.config.json.");
    }

    return this.path.join(workspaceRoot, MCP_CONFIG_FILE);
  }

  async load(workspaceRoot) {
    const configPath = this.getConfigPath(workspaceRoot);
    let rawText;
    let rawConfig;

    try {
      rawText = await this.fs.readFile(configPath, "utf8");
      rawConfig = JSON.parse(rawText);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }

      rawConfig = { mcpServers: {} };
      rawText = `${JSON.stringify(rawConfig, null, 2)}\n`;
    }

    const servers = this._normalizeServers(rawConfig, workspaceRoot);

    return {
      configPath,
      rawText,
      rawConfig,
      servers
    };
  }

  async save(workspaceRoot, rawConfig) {
    const configPath = this.getConfigPath(workspaceRoot);
    const normalizedObject =
      typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
    this._normalizeServers(normalizedObject, workspaceRoot);
    const serialized = `${JSON.stringify(normalizedObject, null, 2)}\n`;

    await this.fs.writeFile(configPath, serialized, "utf8");
    return {
      configPath,
      rawText: serialized
    };
  }

  _normalizeServers(rawConfig, workspaceRoot) {
    const rootObject = normalizeJsonObject(rawConfig);
    const serverEntries = normalizeJsonObject(rootObject.mcpServers);
    const normalized = [];

    for (const [serverName, rawServer] of Object.entries(serverEntries)) {
      normalized.push(
        this._normalizeServer(serverName, rawServer, workspaceRoot)
      );
    }

    return normalized.sort((a, b) => a.name.localeCompare(b.name));
  }

  _normalizeServer(serverName, rawServer, workspaceRoot) {
    if (!rawServer || typeof rawServer !== "object" || Array.isArray(rawServer)) {
      throw new Error(`MCP server "${serverName}" must be a JSON object.`);
    }

    const enabled = rawServer.enabled !== false;
    const command = this._substituteEnvVars(
      String(rawServer.command || "").trim(),
      { allowEmpty: false }
    );
    const args = Array.isArray(rawServer.args)
      ? rawServer.args.map((arg, index) => {
          if (typeof arg !== "string") {
            throw new Error(
              `MCP server "${serverName}" has a non-string arg at index ${index}.`
            );
          }
          return this._substituteEnvVars(arg);
        })
      : [];
    const env = {};

    for (const [key, value] of Object.entries(normalizeJsonObject(rawServer.env))) {
      if (typeof value !== "string") {
        throw new Error(
          `MCP server "${serverName}" env var "${key}" must be a string.`
        );
      }
      env[key] = this._substituteEnvVars(value);
    }

    if (enabled && !command) {
      throw new Error(`MCP server "${serverName}" is enabled but has no command.`);
    }

    const platformCommand = this._normalizeCommandForPlatform(command, args);
    const availability = this._detectCommandAvailability(command, enabled);
    const normalized = {
      name: serverName,
      enabled: enabled && availability.available,
      configuredEnabled: enabled,
      trusted: rawServer.trusted === true,
      command: platformCommand.command,
      args: platformCommand.args,
      env,
      cwd: workspaceRoot,
      originalCommand: command,
      originalArgs: args,
      commandAvailable: availability.available,
      autoDisabledReason: availability.reason
    };

    if (this._isFilesystemServer(serverName, command, args)) {
      normalized.args = this._normalizeFilesystemArgs(
        platformCommand.args,
        workspaceRoot,
        serverName
      );
    }

    return normalized;
  }

  _detectCommandAvailability(command, enabled) {
    if (!enabled) {
      return { available: true, reason: "" };
    }

    const rawCommand = String(command || "").trim();
    if (!rawCommand) {
      return { available: false, reason: "No command configured." };
    }

    if (this.commandExists(rawCommand)) {
      return { available: true, reason: "" };
    }

    return {
      available: false,
      reason: `Auto-disabled because command is not available on PATH: ${rawCommand}`
    };
  }

  _substituteEnvVars(value, options = {}) {
    const text = String(value || "");
    const result = text.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, envName) =>
      Object.prototype.hasOwnProperty.call(process.env, envName)
        ? String(process.env[envName] || "")
        : ""
    );

    if (options.allowEmpty === false && !result.trim()) {
      return "";
    }

    return result;
  }

  _normalizeCommandForPlatform(command, args) {
    if (process.platform !== "win32") {
      return { command, args };
    }

    if (!command) {
      return { command, args };
    }

    const lowerCommand = command.toLowerCase();
    if (
      lowerCommand === "npx" ||
      lowerCommand.endsWith("\\npx.cmd") ||
      lowerCommand.endsWith("/npx.cmd")
    ) {
      return {
        command: "cmd",
        args: ["/c", "npx", ...args]
      };
    }

    return { command, args };
  }

  _isFilesystemServer(serverName, command, args) {
    if (String(serverName || "").toLowerCase() === "filesystem") {
      return true;
    }

    const commandText = `${command || ""} ${Array.isArray(args) ? args.join(" ") : ""}`.toLowerCase();
    return commandText.includes("@modelcontextprotocol/server-filesystem");
  }

  _normalizeFilesystemArgs(args, workspaceRoot, serverName) {
    const normalizedArgs = Array.isArray(args) ? [...args] : [];
    const packageIndex = normalizedArgs.findIndex((arg) =>
      /server-filesystem/i.test(String(arg || ""))
    );
    const rootsStartIndex = packageIndex >= 0 ? packageIndex + 1 : 0;
    const rootIndices = [];

    for (let index = rootsStartIndex; index < normalizedArgs.length; index += 1) {
      const candidate = String(normalizedArgs[index] || "");
      if (!candidate || candidate.startsWith("-")) {
        continue;
      }
      rootIndices.push(index);
    }

    if (rootIndices.length === 0) {
      normalizedArgs.push(workspaceRoot);
      return normalizedArgs;
    }

    for (const index of rootIndices) {
      const rawRoot = String(normalizedArgs[index] || "").trim();
      const resolvedRoot = this.path.resolve(workspaceRoot, rawRoot);
      const relativeToWorkspace = this.path.relative(workspaceRoot, resolvedRoot);
      const escapesWorkspace =
        relativeToWorkspace.startsWith("..") || this.path.isAbsolute(relativeToWorkspace);

      if (escapesWorkspace) {
        throw new Error(
          `Filesystem MCP server "${serverName}" cannot access paths outside the workspace: ${rawRoot}`
        );
      }

      normalizedArgs[index] = resolvedRoot;
    }

    return normalizedArgs;
  }
}

function commandExistsOnPath(command, options = {}) {
  const fsModule = options.fs || fsSync;
  const pathModule = options.path || path;
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const rawCommand = String(command || "").trim();

  if (!rawCommand) {
    return false;
  }

  const hasPathSeparators =
    rawCommand.includes("/") || rawCommand.includes("\\");
  const pathExts =
    platform === "win32"
      ? String(env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      : [""];

  if (hasPathSeparators || pathModule.isAbsolute(rawCommand)) {
    return fileExistsWithExtensions(rawCommand, {
      fs: fsModule,
      pathExts,
      platform
    });
  }

  const pathEntries = String(env.PATH || "")
    .split(pathModule.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    const candidate = pathModule.join(entry, rawCommand);
    if (
      fileExistsWithExtensions(candidate, {
        fs: fsModule,
        pathExts,
        platform
      })
    ) {
      return true;
    }
  }

  return false;
}

function fileExistsWithExtensions(targetPath, options = {}) {
  const fsModule = options.fs || fsSync;
  const platform = options.platform || process.platform;
  const pathExts = Array.isArray(options.pathExts) ? options.pathExts : [""];
  const hasKnownExtension = /\.[a-z0-9]+$/i.test(targetPath);
  const candidates =
    platform === "win32" && !hasKnownExtension
      ? [targetPath, ...pathExts.map((ext) => `${targetPath}${ext}`)]
      : [targetPath];

  return candidates.some((candidate) => {
    try {
      const stat = fsModule.statSync(candidate);
      return stat.isFile();
    } catch (_) {
      return false;
    }
  });
}

module.exports = MCPConfigLoader;
