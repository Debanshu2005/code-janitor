/* eslint-env jest */

const MCPServerConnection = require("../MCPServerConnection");

describe("MCPServerConnection", () => {
  test("disposes pending client and transport artifacts when startup times out", async () => {
    const closeClient = jest.fn().mockResolvedValue(undefined);
    const closeTransport = jest.fn().mockResolvedValue(undefined);

    class FakeClient {
      constructor() {
        this.close = closeClient;
        this.onerror = null;
        this.onclose = null;
      }

      async connect() {
        return new Promise(() => {});
      }
    }

    class FakeTransport {
      constructor() {
        this.close = closeTransport;
      }
    }

    const connection = new MCPServerConnection(
      {
        name: "filesystem",
        enabled: true,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        env: {},
        cwd: "/workspace",
        originalCommand: "npx",
        originalArgs: ["-y", "@modelcontextprotocol/server-filesystem", "."]
      },
      {
        sdkLoader: async () => ({
          Client: FakeClient,
          StdioClientTransport: FakeTransport
        }),
        logger: jest.fn(),
        startTimeoutMs: 5,
        maxRestartAttempts: 0
      }
    );

    await expect(connection.start()).rejects.toThrow(/timed out/i);
    expect(closeClient).toHaveBeenCalledTimes(1);
    expect(closeTransport).toHaveBeenCalledTimes(1);
    expect(connection.client).toBeNull();
    expect(connection.transport).toBeNull();
  });

  test("does not retry missing commands and reports an actionable ENOENT error", async () => {
    class MissingCommandClient {
      constructor() {
        this.onerror = null;
        this.onclose = null;
      }

      async connect() {
        const error = new Error("spawn docker ENOENT");
        error.code = "ENOENT";
        throw error;
      }

      async close() {
        return undefined;
      }
    }

    class MissingCommandTransport {
      async close() {
        return undefined;
      }
    }

    const connection = new MCPServerConnection(
      {
        name: "docker",
        enabled: true,
        command: "docker",
        args: ["run", "-i", "--rm", "mcp/docker"],
        env: {},
        cwd: "/workspace",
        originalCommand: "docker",
        originalArgs: ["run", "-i", "--rm", "mcp/docker"]
      },
      {
        sdkLoader: async () => ({
          Client: MissingCommandClient,
          StdioClientTransport: MissingCommandTransport
        }),
        logger: jest.fn(),
        restartDelayMs: 5,
        maxRestartAttempts: 3
      }
    );

    await expect(connection.start()).rejects.toThrow(/ENOENT/i);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(connection.lastError).toBe(
      'Command not found on PATH: docker. Install it or disable the "docker" MCP server in mcp.config.json.'
    );
    expect(connection.status).toBe("error");
    expect(connection._restartTimer).toBeNull();
    expect(connection._restartAttempts).toBe(0);
  });
});
