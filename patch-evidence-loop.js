const fs = require('fs');

let content = fs.readFileSync('src/ai-agent/chat-panel.js', 'utf8');

// 1. Remove the finalization block from its original position
const originalFinalizationBlock = `
        streamController?.ensureFinalTextVisible(
          this._buildVisibleAssistantText(response, {
            preferStructuredSummary: isEditLikeIntent
          }),
          {
            rawText: typeof response.text === "string" ? response.text : ""
          }
        );
        this._postAssistantImages(response.images);

        this._postMessage({ type: "done" });
        this._postSessionState();
`;

if (content.includes(originalFinalizationBlock.trim())) {
    content = content.replace(originalFinalizationBlock, "\n");
} else {
    console.error("Could not find original finalization block");
}

// 2. Add done before early returns
content = content.replace(
    `          this._postMessage({
            type: "error",
            text:
              response.text ||
              "Structured edit output was incomplete, so Code Janitor blocked the generated file changes."
          });
          return;`,
    `          this._postMessage({
            type: "error",
            text:
              response.text ||
              "Structured edit output was incomplete, so Code Janitor blocked the generated file changes."
          });
          this._postMessage({ type: "done" });
          return;`
);

content = content.replace(
    `          if (response?.error) {
            this._postMessage({
              type: "error",
              text: response.error
            });
            return;
          }`,
    `          if (response?.error) {
            this._postMessage({
              type: "error",
              text: response.error
            });
            this._postMessage({ type: "done" });
            return;
          }`
);

// 3. Insert the finalization block before hasFileAction
const hasFileActionStr = `          const hasFileAction = response.actions.some(`;
content = content.replace(
    hasFileActionStr,
    originalFinalizationBlock.trim() + "\n\n" + hasFileActionStr
);

// 4. Update _runAgenticEvidenceRound call
const agenticCallOld = `            response = await this._runAgenticEvidenceRound(
              requestText,
              response.actions,
              workspaceFolder,
              activeRuntimeConfig || (await this._getEffectiveAiConfig()),
              requestMode,
              combinedSystemOverlay
            );`;
const agenticCallNew = `            response = await this._runAgenticEvidenceRound(
              requestText,
              response.actions,
              workspaceFolder,
              activeRuntimeConfig || (await this._getEffectiveAiConfig()),
              requestMode,
              combinedSystemOverlay,
              streamController
            );`;
content = content.replace(agenticCallOld, agenticCallNew);

// 5. Update _runAgenticEvidenceRound signature and agent.chat call
const sigOld = `  async _runAgenticEvidenceRound(
    originalRequest,
    actions,
    workspaceFolder,
    runtimeConfig,
    requestMode,
    systemOverlay = ""
  ) {`;
const sigNew = `  async _runAgenticEvidenceRound(
    originalRequest,
    actions,
    workspaceFolder,
    runtimeConfig,
    requestMode,
    systemOverlay = "",
    streamController = null
  ) {`;
content = content.replace(sigOld, sigNew);

const chatCallOld = `    return this.agent.chat(
      this._buildEvidenceFollowUpPrompt(originalRequest, toolResults),
      workspaceFolder,
      null,
      null,
      {
        mode: nextMode,`;
const chatCallNew = `    return this.agent.chat(
      this._buildEvidenceFollowUpPrompt(originalRequest, toolResults),
      workspaceFolder,
      streamController ? (chunk) => streamController.push(chunk) : null,
      null,
      {
        mode: nextMode,`;
content = content.replace(chatCallOld, chatCallNew);

fs.writeFileSync('src/ai-agent/chat-panel.js', content);
console.log("Patched successfully.");
