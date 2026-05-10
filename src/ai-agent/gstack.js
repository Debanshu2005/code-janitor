"use strict";

const WORKFLOWS = Object.freeze({
  build: {
    id: "build",
    label: "Codex Build",
    aliases: ["/gstack", "/gstack-build", "/build", "/implement", "/codex"],
    mode: "heavy",
    description:
      "Codex-style implementation workflow with workspace file, folder, and verification access.",
    defaultPrompt:
      "Use a GStack-guided Codex workflow to implement the requested change in the current workspace. Inspect the real code, make the smallest correct set of edits, create files or folders when needed, verify with focused commands when useful, and stop when the task is done.",
    overlay: [
      "GStack Codex workflow active: /gstack.",
      "Operate like Codex using GStack as an execution workflow, not just a review.",
      "When the user asks to build, wire, fix, scaffold, create, edit, or implement, emit executable structured actions instead of a design memo.",
      "You may inspect the workspace, patch existing files, create new files, create directories, and run focused workspace commands through PATCH:, FILE:, MKDIR:, and CMD:.",
      "Inside the workspace, you have permission to make the directories and files needed for the user's request.",
      "Prefer PATCH for existing files, FILE for new files or broad rewrites, MKDIR for directories, and CMD for focused inspection or verification.",
      "Do the work directly: inspect, edit, verify when helpful, then stop.",
      "If the user is only asking for strategy, you may answer normally without structured actions."
    ].join("\n"),
    allowsWrites: true,
    executionStyle: "codex",
    forceStructuredEdits: true
  },
  "office-hours": {
    id: "office-hours",
    label: "Office Hours",
    aliases: ["/office-hours", "/officehours"],
    mode: "heavy",
    description:
      "Idea and product-pressure review before implementation.",
    defaultPrompt:
      "Run GStack Office Hours on what I'm building. Pressure-test the user pain, the status quo, the narrow wedge, why now, and the fastest path to real user learning. End with a compact design brief and next experiments.",
    overlay: [
      "GStack-inspired workflow active: /office-hours.",
      "Operate like a strong product and founder advisor before implementation.",
      "This is design-doc mode by default. Do not emit FILE:, PATCH:, MKDIR:, or CMD: actions unless the user explicitly asks you to save or implement something.",
      "Focus on user pain, current workaround, the narrowest wedge, why this matters now, and what would prove demand quickly.",
      "Lead with the sharpest truth. Ask hard questions when assumptions are weak. Stay constructive.",
      "End with sections titled: Problem, User, Wedge, Risks, Next Experiments."
    ].join("\n")
  },
  "ceo-review": {
    id: "ceo-review",
    label: "CEO Review",
    aliases: ["/ceo", "/ceo-review", "/plan-ceo-review"],
    mode: "heavy",
    description:
      "Rethink scope, ambition, and product sharpness.",
    defaultPrompt:
      "Run a GStack-style CEO review on the idea or plan in my current context. Challenge the premise, find the strongest version of the product, and give me scope expand, hold, and reduce options with a recommendation.",
    overlay: [
      "GStack-inspired workflow active: /plan-ceo-review.",
      "Act like a founder/CEO reviewer. Rethink the problem, not just the implementation.",
      "Default to strategy and planning. Do not emit FILE:, PATCH:, MKDIR:, or CMD: actions unless the user explicitly asks for implementation.",
      "Challenge vague scope, weak ambition, and feature-first thinking.",
      "Offer three paths when useful: expand scope, hold scope, or reduce scope. Recommend one clearly.",
      "Use numbered findings and concise option labels when comparing directions."
    ].join("\n")
  },
  "eng-review": {
    id: "eng-review",
    label: "Eng Review",
    aliases: ["/eng", "/eng-review", "/plan-eng-review"],
    mode: "heavy",
    description:
      "Architecture, failure modes, rollout, and test review.",
    defaultPrompt:
      "Run a GStack-style engineering review on the current plan or code path. Lock the architecture, data flow, edge cases, failure modes, testing strategy, rollout, and rollback before implementation proceeds.",
    overlay: [
      "GStack-inspired workflow active: /plan-eng-review.",
      "Act like an engineering manager reviewing the plan before or during implementation.",
      "Bias toward explicit design, reversibility, good tests, and operational safety.",
      "Call out architecture seams, state ownership, data flow, failure modes, and migration risk.",
      "Default to review and planning. Do not emit FILE:, PATCH:, MKDIR:, or CMD: actions unless the user explicitly asks to apply changes.",
      "When helpful, structure the answer as: Architecture, Risks, Tests, Rollout, Recommendation."
    ].join("\n")
  },
  "design-review": {
    id: "design-review",
    label: "Design Review",
    aliases: ["/design", "/design-review", "/plan-design-review"],
    mode: "heavy",
    description:
      "Visual quality, hierarchy, polish, and UI slop detection.",
    defaultPrompt:
      "Run a GStack-style design review on the current UI or active file. Be direct about hierarchy, spacing, interaction quality, accessibility, and any AI-slop patterns. If a preview inspection would help, use it.",
    overlay: [
      "GStack-inspired workflow active: /design-review.",
      "Review the UI with a strong product-design eye. Be direct about quality.",
      "Look for weak hierarchy, uneven spacing, generic styling, unclear calls to action, poor motion, and accessibility gaps.",
      "If the request is about a previewable UI, prefer PREVIEW: inspect when it would reveal runtime or visual issues.",
      "Default to critique and recommendations first. Do not emit FILE:, PATCH:, MKDIR:, or CMD: actions unless the user explicitly asks for implementation or fixes."
    ].join("\n")
  },
  review: {
    id: "review",
    label: "Code Review",
    aliases: ["/review"],
    mode: "heavy",
    description:
      "Find production bugs, regressions, and missing tests first.",
    defaultPrompt:
      "Run a GStack-style code review on the current change or active area. Lead with the concrete findings only: bugs, regressions, security issues, edge cases, and missing tests. Keep summaries brief.",
    overlay: [
      "GStack-inspired workflow active: /review.",
      "Lead with findings. No long preamble.",
      "Prioritize real bugs, regressions, failure modes, and missing tests over style commentary.",
      "Cite concrete files, functions, or behaviors when possible.",
      "Stay read-only unless the user explicitly asks you to apply fixes."
    ].join("\n")
  },
  qa: {
    id: "qa",
    label: "QA Sweep",
    aliases: ["/qa", "/qa-only"],
    mode: "heavy",
    description:
      "Structured QA pass for active preview, workflow, or feature.",
    defaultPrompt:
      "Run a GStack-style QA sweep on the current feature. Check critical flows first, then high-risk edge cases, then polish. If the active file is previewable, inspect the preview when useful. Report severity, repro steps, and likely fixes.",
    overlay: [
      "GStack-inspired workflow active: /qa.",
      "Act like a pragmatic QA lead. Find what breaks, how to reproduce it, and why it matters.",
      "Prioritize critical and high-severity issues first.",
      "If the active file is previewable and inspection would help, prefer PREVIEW: inspect.",
      "Default to reporting and triage. Only emit FILE:, PATCH:, MKDIR:, or CMD: actions if the user explicitly asks you to fix what you find."
    ].join("\n")
  },
  ship: {
    id: "ship",
    label: "Ship Readiness",
    aliases: ["/ship"],
    mode: "heavy",
    description:
      "Release-readiness review without committing or pushing.",
    defaultPrompt:
      "Run a GStack-style ship-readiness review for the current work. Tell me what blocks shipping, what needs verification, what the rollout and rollback plan should be, and what release note you would write.",
    overlay: [
      "GStack-inspired workflow active: /ship.",
      "This extension does not commit, push, or deploy automatically in this workflow.",
      "Focus on ship readiness: blockers, test evidence, rollout safety, rollback path, observability, and user-facing change summary.",
      "Default to a release checklist and recommendation. Do not emit FILE:, PATCH:, MKDIR:, or CMD: actions unless the user explicitly asks for follow-up implementation."
    ].join("\n")
  }
});

const WORKFLOW_ALIASES = new Map();
for (const workflow of Object.values(WORKFLOWS)) {
  for (const alias of workflow.aliases) {
    WORKFLOW_ALIASES.set(alias.toLowerCase(), workflow.id);
  }
}

function getGStackWorkflow(id) {
  return WORKFLOWS[id] || null;
}

function listGStackWorkflows() {
  return Object.values(WORKFLOWS).map((workflow) => ({
    id: workflow.id,
    label: workflow.label,
    aliases: workflow.aliases.slice(),
    description: workflow.description,
    mode: workflow.mode,
    allowsWrites: Boolean(workflow.allowsWrites),
    executionStyle: workflow.executionStyle || "review"
  }));
}

function parseGStackCommand(message) {
  const text = String(message || "").trim();
  if (!text.startsWith("/")) {
    return null;
  }

  if (/^\/gstack\s+help$/i.test(text)) {
    return {
      type: "help"
    };
  }

  const commandMatch = text.match(/^\/[a-z0-9-]+/i);
  if (!commandMatch) {
    return null;
  }

  const command = commandMatch[0].toLowerCase();
  const workflowId = WORKFLOW_ALIASES.get(command);
  if (!workflowId) {
    return null;
  }

  const workflow = getGStackWorkflow(workflowId);
  const remainder = text.slice(commandMatch[0].length).trim();

  return {
    type: "workflow",
    command,
    workflow,
    userMessage: remainder || workflow.defaultPrompt,
    systemOverlay: workflow.overlay,
    mode: workflow.mode,
    statusText: `GStack workflow: ${workflow.label}`,
    allowsWrites: Boolean(workflow.allowsWrites),
    executionStyle: workflow.executionStyle || "review",
    intentOverride: workflow.intentOverride || "",
    forceStructuredEdits: workflow.forceStructuredEdits === true
  };
}

function buildGStackHelpText() {
  const lines = [
    "GStack-inspired workflows available in Code Janitor:",
    ""
  ];

  for (const workflow of Object.values(WORKFLOWS)) {
    const aliases = workflow.aliases.join(", ");
    lines.push(
      `- ${aliases} — ${workflow.label}: ${workflow.description}`
    );
  }

  lines.push("");
  lines.push(
    "Use `/gstack <task>` for Codex-style implementation with PATCH/FILE/MKDIR/CMD actions when you want the agent to do the work."
  );
  lines.push("Use `/gstack help` to show this list again.");
  lines.push("");
  lines.push(
    "Tip: add details after the command, for example `/eng-review look at the auth rollout plan`."
  );

  return lines.join("\n");
}

function buildGStackEditGateOverlay() {
  return [
    "GStack smart edit gate is active.",
    "You are reviewing a planned code change before execution with strong engineering-review and code-review judgment.",
    "Reply with EXACTLY `APPROVE` if the planned actions are safe, minimal, and aligned with the user's request.",
    "If the plan needs improvement, output a complete replacement set of structured actions only: FILE:, PATCH:, MKDIR:, and CMD: as needed.",
    "Do not output explanations, markdown commentary, or partial advice.",
    "Priorities: preserve user intent, minimize blast radius, protect architecture, avoid regressions, prefer targeted patches over broad rewrites, and keep the project buildable."
  ].join("\n");
}

module.exports = {
  buildGStackEditGateOverlay,
  buildGStackHelpText,
  getGStackWorkflow,
  listGStackWorkflows,
  parseGStackCommand
};
