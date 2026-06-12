const vscode = require("vscode");

class ProjectPlannerView {
  constructor(context, workspaceMemoryService) {
    this.context = context;
    this.workspaceMemoryService = workspaceMemoryService;
    this.view = null;

    if (this.workspaceMemoryService?.onProjectPlannerStateChange) {
      const subscription = this.workspaceMemoryService.onProjectPlannerStateChange(
        () => {
          this._postPlannerState().catch((error) => {
            console.warn("[ProjectPlannerView] Failed to post planner state:", error);
          });
        }
      );
      this.context.subscriptions.push(subscription);
    }

    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this._postPlannerState().catch((error) => {
          console.warn("[ProjectPlannerView] Failed to refresh on editor change:", error);
        });
      })
    );

    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("codeJanitor.assistant.projectPlanner") ||
          event.affectsConfiguration("codeJanitor.assistant.workspaceMemory")
        ) {
          this._postPlannerState().catch((error) => {
            console.warn("[ProjectPlannerView] Failed to refresh on config change:", error);
          });
        }
      })
    );
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        try {
          await this._handleMessage(message);
        } catch (error) {
          console.warn("[ProjectPlannerView] Message handling failed:", error);
        }
      },
      null,
      this.context.subscriptions
    );
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = null;
      }
    });
    webviewView.webview.html = this._getHtmlContent(webviewView.webview);
    this._postPlannerState().catch((error) => {
      console.warn("[ProjectPlannerView] Failed to load initial state:", error);
    });
  }

  async _handleMessage(message) {
    const type = String(message?.type || "").trim();
    if (!type) return;

    if (type === "ready") {
      await this._postPlannerState();
      return;
    }

    if (type === "openChat") {
      await vscode.commands.executeCommand("codeJanitor.openChat");
      return;
    }

    if (type === "openSettings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "codeJanitor.assistant.projectPlanner"
      );
      return;
    }

    if (type === "refreshPlanner") {
      if (typeof this.workspaceMemoryService?.refreshAllNow === "function") {
        await this.workspaceMemoryService.refreshAllNow("manual", {
          force: true
        });
      }
      await this._postPlannerState();
      return;
    }

    if (type === "generateStandby") {
      if (
        typeof this.workspaceMemoryService?.generateProjectPlannerStandbyDraft ===
        "function"
      ) {
        await this.workspaceMemoryService.generateProjectPlannerStandbyDraft();
      } else if (typeof this.workspaceMemoryService?.refreshAllNow === "function") {
        await this.workspaceMemoryService.refreshAllNow("manual", {
          force: true
        });
      }
      await this._postPlannerState();
      return;
    }

    if (type === "openStandbyDraft") {
      await this._openStandbyDraftDocument();
    }
  }

  async _postPlannerState() {
    if (!this.view?.webview || !this.workspaceMemoryService?.getProjectPlannerState) {
      return;
    }

    const state = await this.workspaceMemoryService.getProjectPlannerState();
    this.view.webview.postMessage({
      type: "plannerState",
      state
    });
  }

  async _openStandbyDraftDocument() {
    if (!this.workspaceMemoryService?.getProjectPlannerState) {
      return;
    }

    const state = await this.workspaceMemoryService.getProjectPlannerState();
    const standby = state?.standbyProposal;
    if (!standby || (!standby.summary && !standby.patch)) {
      vscode.window.showInformationMessage(
        "Code Janitor: No standby draft is available yet."
      );
      return;
    }

    const targetFiles = Array.isArray(standby.targetFiles)
      ? standby.targetFiles.filter(Boolean)
      : [];
    const generatedAt = Number(standby.generatedAt || state.lastStandbyAt || 0);
    const generatedLabel = generatedAt
      ? new Date(generatedAt).toLocaleString()
      : "unknown time";
    const content =
      "# Project Planner Standby Draft\n\n" +
      `- Outcome: ${state.outcome || "not set"}\n` +
      `- Deadline: ${state.deadlineText || "not set"}\n` +
      `- Generated: ${generatedLabel}\n` +
      `- Target files: ${targetFiles.length ? targetFiles.join(", ") : "not specified"}\n\n` +
      "## Summary\n\n" +
      `${standby.summary || "No summary provided."}\n\n` +
      "## Review Notes\n\n" +
      "- This is a review-only standby draft.\n" +
      "- It has not been applied automatically.\n" +
      "- Validate scope and file targets before using any part of it.\n\n" +
      "## Proposed Patch\n\n" +
      "```diff\n" +
      `${standby.patch || "# No patch body was generated."}\n` +
      "\n```";

    const document = await vscode.workspace.openTextDocument({
      content,
      language: "markdown"
    });
    await vscode.window.showTextDocument(document, {
      preview: false
    });
  }

  _getHtmlContent(webview) {
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Project Planner</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: var(--vscode-font-family);
        color: var(--vscode-sideBar-foreground);
        background: var(--vscode-sideBar-background);
      }
      .shell {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .card {
        background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
        border: 1px solid var(--vscode-widget-border, var(--vscode-sideBar-border, transparent));
        border-radius: 10px;
        padding: 12px;
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
      }
      .eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 4px;
      }
      h1 {
        margin: 0;
        font-size: 16px;
        line-height: 1.2;
      }
      .subtitle {
        margin: 6px 0 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--vscode-descriptionForeground);
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      button {
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 999px;
        padding: 7px 12px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      button.secondary {
        background: var(--vscode-button-secondaryBackground, transparent);
        color: var(--vscode-button-secondaryForeground, var(--vscode-sideBar-foreground));
      }
      button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      button.secondary:hover {
        background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
      }
      .status-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 5px 10px;
        font-size: 11px;
        font-weight: 600;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      .chip.warn {
        background: rgba(255, 180, 0, 0.18);
        color: var(--vscode-editorWarning-foreground, var(--vscode-sideBar-foreground));
      }
      .chip.success {
        background: rgba(63, 185, 80, 0.18);
        color: var(--vscode-testing-iconPassed, var(--vscode-sideBar-foreground));
      }
      .updated-at {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .outcome {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.45;
        margin: 0 0 8px;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }
      .meta-item {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-widget-border, var(--vscode-sideBar-border, transparent));
        border-radius: 999px;
        padding: 4px 8px;
      }
      .progress-track {
        height: 8px;
        border-radius: 999px;
        background: var(--vscode-progressBar-background, rgba(128, 128, 128, 0.2));
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--vscode-textLink-foreground),
          var(--vscode-button-background)
        );
        transition: width 0.22s ease;
      }
      .progress-row {
        margin-top: 10px;
        display: flex;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
      }
      .section-title {
        margin: 0 0 10px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--vscode-descriptionForeground);
      }
      .empty {
        font-size: 12px;
        line-height: 1.6;
        color: var(--vscode-descriptionForeground);
      }
      .todo-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .todo-item {
        border: 1px solid var(--vscode-widget-border, var(--vscode-sideBar-border, transparent));
        border-radius: 10px;
        padding: 10px;
        background: rgba(127, 127, 127, 0.05);
      }
      .todo-top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
      }
      .todo-text {
        font-size: 12px;
        line-height: 1.5;
      }
      .todo-status {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
      }
      .todo-item.completed .todo-text {
        opacity: 0.75;
        text-decoration: line-through;
      }
      .todo-window {
        margin-top: 6px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .rescue {
        display: none;
      }
      .rescue.visible {
        display: block;
        border-color: rgba(255, 180, 0, 0.25);
        background: rgba(255, 180, 0, 0.08);
      }
      .rescue-text {
        font-size: 12px;
        line-height: 1.6;
        color: var(--vscode-sideBar-foreground);
        white-space: pre-wrap;
      }
      .standby {
        display: none;
      }
      .standby.visible {
        display: block;
      }
      .standby-subtitle {
        margin: 0 0 8px;
        font-size: 12px;
        line-height: 1.6;
        color: var(--vscode-sideBar-foreground);
      }
      .standby-files {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
      }
      .standby-file {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-widget-border, var(--vscode-sideBar-border, transparent));
        border-radius: 999px;
        padding: 4px 8px;
      }
      .standby-preview {
        margin: 0;
        padding: 10px;
        border-radius: 10px;
        border: 1px solid var(--vscode-widget-border, var(--vscode-sideBar-border, transparent));
        background: rgba(127, 127, 127, 0.06);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 11px;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-x: auto;
        max-height: 220px;
      }
      .standby-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 10px;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <div class="topbar">
          <div>
            <div class="eyebrow">Code Janitor</div>
            <h1>Project Planner</h1>
            <p class="subtitle">Main-sidebar progress for the active workspace, without pinning the planner at the top of chat.</p>
          </div>
          <div class="actions">
            <button id="refresh-btn">Refresh</button>
            <button id="chat-btn" class="secondary">Open Chat</button>
            <button id="settings-btn" class="secondary">Settings</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="status-row">
          <div id="planner-chip" class="chip">Planner disabled</div>
          <div id="updated-at" class="updated-at">Waiting for planner state</div>
        </div>
        <p id="outcome-text" class="outcome">Enable the project planner to track outcome progress here.</p>
        <div id="meta-row" class="meta"></div>
        <div class="progress-track">
          <div id="progress-fill" class="progress-fill"></div>
        </div>
        <div class="progress-row">
          <span id="progress-label">0% complete</span>
          <span id="summary-text">No active plan yet</span>
        </div>
      </div>

      <div id="rescue-card" class="card rescue">
        <div class="section-title">Rescue Brief</div>
        <div id="rescue-text" class="rescue-text"></div>
      </div>

      <div id="standby-card" class="card standby">
        <div class="section-title">Standby Draft</div>
        <p id="standby-summary" class="standby-subtitle"></p>
        <div id="standby-files" class="standby-files"></div>
        <pre id="standby-preview" class="standby-preview"></pre>
        <div class="standby-actions">
          <button id="standby-open-btn">Open Draft</button>
          <button id="standby-regenerate-btn" class="secondary">Regenerate</button>
        </div>
      </div>

      <div class="card">
        <div class="section-title">Plan</div>
        <div id="empty-state" class="empty">No plan items yet. Open chat or planner settings to define the outcome and generate the todo list.</div>
        <ul id="todo-list" class="todo-list"></ul>
      </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const plannerChip = document.getElementById("planner-chip");
      const updatedAt = document.getElementById("updated-at");
      const outcomeText = document.getElementById("outcome-text");
      const metaRow = document.getElementById("meta-row");
      const progressFill = document.getElementById("progress-fill");
      const progressLabel = document.getElementById("progress-label");
      const summaryText = document.getElementById("summary-text");
      const rescueCard = document.getElementById("rescue-card");
      const rescueText = document.getElementById("rescue-text");
      const standbyCard = document.getElementById("standby-card");
      const standbySummary = document.getElementById("standby-summary");
      const standbyFiles = document.getElementById("standby-files");
      const standbyPreview = document.getElementById("standby-preview");
      const emptyState = document.getElementById("empty-state");
      const todoList = document.getElementById("todo-list");

      function formatTimestamp(value) {
        const numeric = Number(value || 0);
        if (!numeric) return "Waiting for planner state";
        return "Updated " + new Date(numeric).toLocaleString();
      }

      function formatStatus(status) {
        if (status === "completed") return "Completed";
        if (status === "in_progress") return "In progress";
        return "Pending";
      }

      function setMeta(state) {
        const items = [];
        if (state.deadlineText) items.push("Deadline: " + state.deadlineText);
        if (state.preferredProvider) items.push("Planner AI: " + state.preferredProvider);
        if (state.stagnationMinutes) items.push("Rescue after " + state.stagnationMinutes + " min");
        metaRow.innerHTML = "";
        items.forEach(function(text) {
          const item = document.createElement("div");
          item.className = "meta-item";
          item.textContent = text;
          metaRow.appendChild(item);
        });
      }

      function renderTodos(items) {
        todoList.innerHTML = "";
        if (!Array.isArray(items) || items.length === 0) {
          emptyState.style.display = "block";
          return;
        }

        emptyState.style.display = "none";
        items.forEach(function(item) {
          const row = document.createElement("li");
          row.className = "todo-item " + (item.status || "pending");

          const top = document.createElement("div");
          top.className = "todo-top";

          const text = document.createElement("div");
          text.className = "todo-text";
          text.textContent = item.text || "";

          const status = document.createElement("div");
          status.className = "todo-status";
          status.textContent = formatStatus(item.status);

          top.appendChild(text);
          top.appendChild(status);
          row.appendChild(top);

          if (item.targetWindow) {
            const windowText = document.createElement("div");
            windowText.className = "todo-window";
            windowText.textContent = item.targetWindow;
            row.appendChild(windowText);
          }

          todoList.appendChild(row);
        });
      }

      function renderStandbyProposal(proposal) {
        const standby = proposal || null;
        standbyFiles.innerHTML = "";

        if (!standby || (!standby.summary && !standby.patch)) {
          standbyCard.classList.remove("visible");
          standbySummary.textContent = "";
          standbyPreview.textContent = "";
          return;
        }

        standbyCard.classList.add("visible");
        standbySummary.textContent =
          standby.summary || "Review this standby draft before using it.";

        (standby.targetFiles || []).forEach(function(file) {
          const item = document.createElement("div");
          item.className = "standby-file";
          item.textContent = file;
          standbyFiles.appendChild(item);
        });

        standbyPreview.textContent =
          standby.patch || "# No patch body was generated for this draft.";
      }

      function applyPlannerState(state) {
        const plannerState = state || {};
        const enabled = plannerState.enabled === true;
        const hasOutcome = !!(plannerState.outcome || "").trim();
        const percent = Math.max(
          0,
          Math.min(100, Number(plannerState.progressPercent || 0))
        );
        const lastSignal = Math.max(
          Number(plannerState.lastProgressAt || 0),
          Number(plannerState.lastActivityAt || 0),
          Number(plannerState.lastPlanGeneratedAt || 0)
        );

        plannerChip.className = "chip";
        if (!enabled) {
          plannerChip.textContent = "Planner disabled";
          outcomeText.textContent =
            "Enable the project planner in Code Janitor settings or from chat to keep progress visible here.";
          summaryText.textContent = "No active plan yet";
        } else if (plannerState.isStale) {
          plannerChip.textContent = "Plan needs attention";
          plannerChip.classList.add("warn");
          outcomeText.textContent = hasOutcome
            ? plannerState.outcome
            : "Planner is enabled, but it still needs an outcome.";
          summaryText.textContent =
            plannerState.summary || "Progress has gone stale and may need a rescue brief.";
        } else {
          plannerChip.textContent = "Planner active";
          plannerChip.classList.add("success");
          outcomeText.textContent = hasOutcome
            ? plannerState.outcome
            : "Planner is enabled. Add the outcome in chat to generate the plan.";
          summaryText.textContent =
            plannerState.summary || "Progress is being tracked from workspace activity.";
        }

        updatedAt.textContent = formatTimestamp(lastSignal);
        progressFill.style.width = percent + "%";
        progressLabel.textContent = percent + "% complete";
        setMeta(plannerState);
        renderTodos(plannerState.todoList || []);
        renderStandbyProposal(plannerState.standbyProposal || null);

        if (plannerState.rescueSummary) {
          rescueCard.classList.add("visible");
          rescueText.textContent = plannerState.rescueSummary;
        } else {
          rescueCard.classList.remove("visible");
          rescueText.textContent = "";
        }
      }

      document.getElementById("refresh-btn").addEventListener("click", function() {
        vscode.postMessage({ type: "refreshPlanner" });
      });
      document.getElementById("chat-btn").addEventListener("click", function() {
        vscode.postMessage({ type: "openChat" });
      });
      document.getElementById("settings-btn").addEventListener("click", function() {
        vscode.postMessage({ type: "openSettings" });
      });
      document.getElementById("standby-open-btn").addEventListener("click", function() {
        vscode.postMessage({ type: "openStandbyDraft" });
      });
      document.getElementById("standby-regenerate-btn").addEventListener("click", function() {
        vscode.postMessage({ type: "generateStandby" });
      });

      window.addEventListener("message", function(event) {
        const message = event.data || {};
        if (message.type === "plannerState") {
          applyPlannerState(message.state);
        }
      });

      vscode.postMessage({ type: "ready" });
    </script>
  </body>
</html>`;
  }
}

function getNonce() {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let index = 0; index < 32; index += 1) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return result;
}

module.exports = ProjectPlannerView;
