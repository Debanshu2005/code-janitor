/* eslint-env jest */

const fs = require("fs").promises;
const os = require("os");
const path = require("path");

const MCPConfigLoader = require("../MCPConfigLoader");

describe("MCPConfigLoader", () => {
  let workspaceRoot;
  let previousToken;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cj-mcp-config-"));
    previousToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "token-from-env";
  });

  afterEach(async () => {
    if (previousToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousToken;
    }

    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  test("returns an empty MCP config when mcp.config.json is missing", async () => {
    const loader = new MCPConfigLoader();
    const loaded = await loader.load(workspaceRoot);

    expect(loaded.configPath).toBe(path.join(workspaceRoot, "mcp.config.json"));
    expect(loaded.rawConfig).toEqual({ mcpServers: {} });
    expect(loaded.servers).toEqual([]);
  });

  test("loads config, substitutes env vars, and scopes the filesystem server to the workspace", async () => {
    await fs.writeFile(
      path.join(workspaceRoot, "mcp.config.json"),
      JSON.stringify(
        {
          mcpServers: {
            filesystem: {
              enabled: true,
              command: "npx",
              args: [
                "-y",
                "@modelcontextprotocol/server-filesystem",
                "."
              ]
            },
            github: {
              enabled: true,
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              env: {
                GITHUB_TOKEN: "${GITHUB_TOKEN}"
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const loader = new MCPConfigLoader();
    const loaded = await loader.load(workspaceRoot);

    const filesystemServer = loaded.servers.find(
      (server) => server.name === "filesystem"
    );
    const githubServer = loaded.servers.find(
      (server) => server.name === "github"
    );

    expect(filesystemServer).toBeTruthy();
    expect(githubServer).toBeTruthy();
    expect(githubServer.env.GITHUB_TOKEN).toBe("token-from-env");

    const filesystemArgs = filesystemServer.args.join(" ");
    expect(filesystemArgs).toContain(workspaceRoot);
    expect(filesystemArgs).not.toContain(" .");
  });

  test("rejects filesystem roots that escape the workspace", async () => {
    await fs.writeFile(
      path.join(workspaceRoot, "mcp.config.json"),
      JSON.stringify(
        {
          mcpServers: {
            filesystem: {
              enabled: true,
              command: "npx",
              args: [
                "-y",
                "@modelcontextprotocol/server-filesystem",
                ".."
              ]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const loader = new MCPConfigLoader();

    await expect(loader.load(workspaceRoot)).rejects.toThrow(
      /cannot access paths outside the workspace/i
    );
  });

  test("validates config before saving it to disk", async () => {
    const loader = new MCPConfigLoader();

    await expect(
      loader.save(workspaceRoot, {
        mcpServers: {
          filesystem: {
            enabled: true,
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", ".."]
          }
        }
      })
    ).rejects.toThrow(/cannot access paths outside the workspace/i);

    await expect(
      fs.readFile(path.join(workspaceRoot, "mcp.config.json"), "utf8")
    ).rejects.toThrow();
  });

  test("auto-disables configured servers whose command is missing from PATH", async () => {
    await fs.writeFile(
      path.join(workspaceRoot, "mcp.config.json"),
      JSON.stringify(
        {
          mcpServers: {
            docker: {
              enabled: true,
              command: "docker",
              args: ["run", "-i", "--rm", "mcp/docker"]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const loader = new MCPConfigLoader({
      commandExists: jest.fn(() => false)
    });
    const loaded = await loader.load(workspaceRoot);

    expect(loaded.servers).toEqual([
      expect.objectContaining({
        name: "docker",
        configuredEnabled: true,
        enabled: false,
        commandAvailable: false,
        autoDisabledReason:
          "Auto-disabled because command is not available on PATH: docker"
      })
    ]);
  });
});
