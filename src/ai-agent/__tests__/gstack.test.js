/* eslint-env jest */

const {
  buildGStackEditGateOverlay,
  buildGStackHelpText,
  listGStackWorkflows,
  parseGStackCommand
} = require("../gstack");

describe("gstack workflow integration", () => {
  test("routes /gstack into the Codex-style build workflow", () => {
    const parsed = parseGStackCommand(
      "/gstack wire in gstack like codex and let it create files"
    );

    expect(parsed).toMatchObject({
      type: "workflow",
      command: "/gstack",
      mode: "heavy",
      statusText: "GStack workflow: Codex Build",
      userMessage: "wire in gstack like codex and let it create files",
      allowsWrites: true,
      executionStyle: "codex",
      intentOverride: "edit",
      forceStructuredEdits: true
    });
    expect(parsed.workflow.id).toBe("build");
    expect(parsed.systemOverlay).toContain("PATCH:, FILE:, MKDIR:, and CMD:");
    expect(parsed.systemOverlay).toContain(
      "permission to make the directories and files needed"
    );
  });

  test("parses workflow commands with inline follow-up text", () => {
    const parsed = parseGStackCommand(
      "/eng-review lock the auth rollout before we code"
    );

    expect(parsed).toMatchObject({
      type: "workflow",
      command: "/eng-review",
      mode: "heavy",
      statusText: "GStack workflow: Eng Review",
      userMessage: "lock the auth rollout before we code"
    });
    expect(parsed.workflow.label).toBe("Eng Review");
    expect(parsed.systemOverlay).toContain("/plan-eng-review");
  });

  test("uses workflow defaults when only the slash command is provided", () => {
    const parsed = parseGStackCommand("/review");

    expect(parsed.type).toBe("workflow");
    expect(parsed.userMessage).toContain("GStack-style code review");
    expect(parsed.workflow.id).toBe("review");
  });

  test("returns help mode for /gstack help", () => {
    expect(parseGStackCommand("/gstack help")).toEqual({ type: "help" });
  });

  test("lists discoverable workflows in help text", () => {
    const help = buildGStackHelpText();
    const workflows = listGStackWorkflows();

    expect(help).toContain("/gstack");
    expect(help).toContain("/office-hours");
    expect(help).toContain("/ship");
    expect(
      workflows.find((workflow) => workflow.id === "build")
    ).toMatchObject({
      allowsWrites: true,
      executionStyle: "codex"
    });
    expect(workflows.some((workflow) => workflow.id === "qa")).toBe(true);
    expect(workflows.some((workflow) => workflow.id === "ceo-review")).toBe(
      true
    );
  });

  test("builds a dedicated edit gate overlay", () => {
    const overlay = buildGStackEditGateOverlay();

    expect(overlay).toContain("GStack smart edit gate is active.");
    expect(overlay).toContain("Reply with EXACTLY `APPROVE`");
    expect(overlay).toContain("replacement set of structured actions only");
  });
});
