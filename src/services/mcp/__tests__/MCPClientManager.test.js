/* eslint-env jest */

const MCPClientManager = require("../MCPClientManager");

describe("MCPClientManager", () => {
  test("reuses an in-flight initialization for the same workspace root", async () => {
    let resolveLoad;
    const loadPromise = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    const fakeConnection = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      snapshot: jest.fn(() => ({
        name: "filesystem",
        enabled: true,
        status: "connected",
        toolCount: 0,
        tools: [],
        lastError: "",
        restartAttempts: 0,
        instructions: "",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
      })),
      serverConfig: {
        name: "filesystem",
        enabled: true
      },
      name: "filesystem",
      status: "connected",
      tools: []
    };
    const configLoader = {
      load: jest.fn().mockReturnValue(loadPromise)
    };
    const manager = new MCPClientManager({
      configLoader,
      connectionFactory: jest.fn(() => fakeConnection),
      logger: jest.fn()
    });

    const firstInitialize = manager.initialize("/workspace");
    const secondInitialize = manager.initialize("/workspace");

    resolveLoad({
      configPath: "/workspace/mcp.config.json",
      rawText: "{\"mcpServers\":{}}",
      rawConfig: { mcpServers: {} },
      servers: [
        {
          name: "filesystem",
          enabled: true,
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
          env: {},
          cwd: "/workspace",
          originalCommand: "npx",
          originalArgs: ["-y", "@modelcontextprotocol/server-filesystem", "."]
        }
      ]
    });

    await Promise.all([firstInitialize, secondInitialize]);

    expect(configLoader.load).toHaveBeenCalledTimes(1);
    expect(fakeConnection.start).toHaveBeenCalledTimes(1);
  });

  test("initializes servers, lists tools, and delegates tool calls", async () => {
    const fakeConnection = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      restart: jest.fn().mockResolvedValue(undefined),
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "hello from mcp" }],
        structuredContent: { ok: true },
        isError: false
      }),
      getTool: jest.fn().mockReturnValue({
        name: "read_file",
        description: "Read a file",
        annotations: { readOnlyHint: true }
      }),
      snapshot: jest.fn(() => ({
        name: "filesystem",
        enabled: true,
        status: "connected",
        toolCount: 1,
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            annotations: { readOnlyHint: true }
          }
        ],
        lastError: "",
        restartAttempts: 0,
        instructions: "Stay inside the workspace.",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
      })),
      serverConfig: {
        name: "filesystem",
        enabled: true
      },
      name: "filesystem",
      status: "connected",
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          annotations: { readOnlyHint: true }
        }
      ]
    };

    const manager = new MCPClientManager({
      configLoader: {
        load: jest.fn().mockResolvedValue({
          configPath: "/workspace/mcp.config.json",
          rawText: "{\"mcpServers\":{}}",
          rawConfig: { mcpServers: {} },
          servers: [
            {
              name: "filesystem",
              enabled: true,
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
              env: {},
              cwd: "/workspace",
              originalCommand: "npx",
              originalArgs: ["-y", "@modelcontextprotocol/server-filesystem", "."]
            }
          ]
        })
      },
      connectionFactory: jest.fn(() => fakeConnection),
      logger: jest.fn()
    });

    await manager.initialize("/workspace");

    expect(fakeConnection.start).toHaveBeenCalled();
    expect(manager.listServers()).toHaveLength(1);
    expect(manager.listTools()).toEqual([
      expect.objectContaining({
        serverName: "filesystem",
        name: "read_file"
      })
    ]);

    const result = await manager.callTool("filesystem", "read_file", {
      path: "src/extension.js"
    });

    expect(fakeConnection.callTool).toHaveBeenCalledWith(
      "read_file",
      { path: "src/extension.js" },
      expect.any(Object)
    );
    expect(result.structuredContent).toEqual({ ok: true });
    expect(manager.buildPromptContext()).toContain("MCP_TOOL:");
    expect(manager.buildPromptContext()).toContain("read_file");
  });

  test("does not try to start auto-disabled servers with missing commands", async () => {
    const fakeConnection = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      snapshot: jest.fn(() => ({
        name: "docker",
        enabled: false,
        configuredEnabled: true,
        status: "disabled",
        toolCount: 0,
        tools: [],
        lastError: "",
        restartAttempts: 0,
        instructions: "",
        commandAvailable: false,
        autoDisabledReason:
          "Auto-disabled because command is not available on PATH: docker",
        command: "docker",
        args: ["run", "-i", "--rm", "mcp/docker"]
      })),
      serverConfig: {
        name: "docker",
        enabled: false,
        configuredEnabled: true,
        commandAvailable: false,
        autoDisabledReason:
          "Auto-disabled because command is not available on PATH: docker"
      },
      name: "docker",
      status: "disabled",
      tools: []
    };

    const manager = new MCPClientManager({
      configLoader: {
        load: jest.fn().mockResolvedValue({
          configPath: "/workspace/mcp.config.json",
          rawText: "{\"mcpServers\":{}}",
          rawConfig: { mcpServers: {} },
          servers: [
            {
              name: "docker",
              enabled: false,
              configuredEnabled: true,
              command: "docker",
              args: ["run", "-i", "--rm", "mcp/docker"],
              env: {},
              cwd: "/workspace",
              originalCommand: "docker",
              originalArgs: ["run", "-i", "--rm", "mcp/docker"],
              commandAvailable: false,
              autoDisabledReason:
                "Auto-disabled because command is not available on PATH: docker"
            }
          ]
        })
      },
      connectionFactory: jest.fn(() => fakeConnection),
      logger: jest.fn()
    });

    await manager.initialize("/workspace");

    expect(fakeConnection.start).not.toHaveBeenCalled();
    expect(manager.listServers()).toEqual([
      expect.objectContaining({
        name: "docker",
        enabled: false,
        configuredEnabled: true,
        commandAvailable: false,
        autoDisabledReason:
          "Auto-disabled because command is not available on PATH: docker"
      })
    ]);
  });
});
