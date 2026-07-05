/* eslint-env jest */

const {
  assessToolRisk,
  validateMcpCall
} = require("../MCPToolExecutor");

describe("MCPToolExecutor risk assessment", () => {
  test("allows explicitly read-only tools", () => {
    const risk = assessToolRisk("filesystem", {
      name: "read_file",
      annotations: {
        readOnlyHint: true
      }
    });

    expect(risk.requiresConfirmation).toBe(false);
  });

  test("requires confirmation for destructive annotations on any server", () => {
    const risk = assessToolRisk("filesystem", {
      name: "edit_file",
      annotations: {
        destructiveHint: true
      }
    });

    expect(risk.requiresConfirmation).toBe(true);
    expect(risk.reason).toContain("filesystem");
  });

  test("requires confirmation for risky tool names beyond GitHub and Docker", () => {
    const risk = assessToolRisk("postgres", {
      name: "execute_sql_update"
    });

    expect(risk.requiresConfirmation).toBe(true);
  });

  test("validates MCP call shape", () => {
    expect(validateMcpCall({ serverName: "s", toolName: "t" }).valid).toBe(true);
    expect(validateMcpCall({ serverName: "", toolName: "t" }).valid).toBe(false);
  });
});
