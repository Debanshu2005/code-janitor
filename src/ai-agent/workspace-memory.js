const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const vscode = require("../utils/vscode-shim");
const { fetchGitHubContext } = require("./tools/fetch-github-context");
const { computeMinimalReplacement } = require("../utils/minimal-diff");

const WORKSPACE_MEMORY_STATE_KEY = "codeJanitor.workspaceMemory.state";
const DEFAULT_OUTPUT_RELATIVE_PATH = "graphify-out/WORKSPACE_MEMORY.md";
const DEFAULT_REFRESH_DELAY_MS = 1500;
const DEFAULT_MAX_RECENT_CHANGES = 40;
const MAX_RENDERED_CHANGES = 15;
const MAX_RENDERED_HOT_FILES = 8;
const MAX_RENDERED_TOP_LEVEL = 8;
const MAX_RENDERED_FILE_TYPES = 8;
const MAX_RENDERED_KEY_FILES = 8;
const MAX_RENDERED_GIT_STATUS = 12;
const GRAPH_SECTION_CHAR_LIMIT = 1200;
const GITHUB_SUMMARY_CHAR_LIMIT = 1400;
const CHANGE_FRAGMENT_CHAR_LIMIT = 180;
const SNAPSHOT_PREVIEW_CHAR_LIMIT = 220;
const MAX_CHANGE_SUMMARY_CHAR_LIMIT = 220;
const MAX_TRACKED_FILE_SNAPSHOTS = 200;
const MAX_TEXT_SNAPSHOT_BYTES = 256 * 1024;
const IGNORED_DIRS = new Set([
  ".git",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "tmp",
  ".tmp",
  ".next",
  ".turbo",
  "__pycache__",
  "graphify-out"
]);
const KEY_FILE_NAMES = new Set([
  "agents.md",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "readme.md",
  "tsconfig.json",
  "jsconfig.json",
  ".gitignore",
  "src/extension.js",
  "src/ai-agent/agent.js",
  "src/ai-agent/chat-panel.js"
]);
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav"
]);

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function extractMarkdownSection(markdown, heading) {
  const text = String(markdown || "");
  if (!text) {
    return "";
  }

  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) {
    return "";
  }

  const remainder = text.slice(start);
  const nextSectionOffset = remainder.indexOf("\n## ", marker.length);
  return (
    nextSectionOffset >= 0
      ? remainder.slice(0, nextSectionOffset)
      : remainder
  ).trim();
}

function extractGraphReportHighlights(reportText) {
  const overview = extractMarkdownSection(reportText, "Overview");
  const godNodes = extractMarkdownSection(reportText, "God Nodes (High Connectivity)");
  const architectureInsights = extractMarkdownSection(
    reportText,
    "Architecture Insights"
  );

  return truncateText(
    [overview, godNodes, architectureInsights].filter(Boolean).join("\n\n"),
    GRAPH_SECTION_CHAR_LIMIT
  );
}

function isIgnoredWorkspacePath(relativePath) {
  const normalized = String(relativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();

  if (!normalized) {
    return true;
  }

  const parts = normalized.split("/");
  return parts.some((part) => IGNORED_DIRS.has(part));
}

function formatIsoTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toISOString();
}

function formatChangeLabel(change) {
  if (!change || !change.type) {
    return "updated";
  }

  if (change.type === "save") return "saved";
  if (change.type === "create") return "created";
  if (change.type === "delete") return "deleted";
  if (change.type === "rename") return "renamed";
  return change.type;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countLines(text) {
  const value = String(text || "");
  if (!value) {
    return 0;
  }
  return value.split(/\r?\n/).length;
}

function hashText(text) {
  const value = String(text || "");
  if (!value) {
    return "empty";
  }
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function createCompactPreview(text, maxLength = SNAPSHOT_PREVIEW_CHAR_LIMIT) {
  const compact = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ");
  return truncateText(compact, maxLength);
}

function createTextSnapshot(text) {
  if (text === null || text === undefined) {
    return null;
  }

  const value = String(text);
  return {
    kind: "text",
    lineCount: countLines(value),
    charCount: value.length,
    hash: hashText(value),
    preview: createCompactPreview(value),
    updatedAt: Date.now()
  };
}

function getLineNumberAtOffset(text, offset) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  return countLines(String(text || "").slice(0, safeOffset)) || 1;
}

function summarizeContentChange(beforeText, afterText) {
  const beforeValue = String(beforeText || "");
  const afterValue = String(afterText || "");
  const diff = computeMinimalReplacement(beforeValue, afterValue);
  if (!diff) {
    return null;
  }

  const removedFragment = beforeValue.slice(diff.startOffset, diff.endOffset);
  const insertedFragment = diff.replacement;
  const removedLines = removedFragment ? countLines(removedFragment) : 0;
  const addedLines = insertedFragment ? countLines(insertedFragment) : 0;
  const startLine = getLineNumberAtOffset(beforeValue, diff.startOffset);

  let summary = `Line ${startLine}: `;
  if (removedLines === 0) {
    summary += `inserted ${pluralize(addedLines, "line")}.`;
  } else if (addedLines === 0) {
    summary += `removed ${pluralize(removedLines, "line")}.`;
  } else {
    summary += `replaced ${pluralize(removedLines, "line")} with ${pluralize(addedLines, "line")}.`;
  }

  return {
    lineStart: startLine,
    removedLines,
    addedLines,
    summary: truncateText(summary, MAX_CHANGE_SUMMARY_CHAR_LIMIT),
    beforeFragment: createCompactPreview(
      removedFragment,
      CHANGE_FRAGMENT_CHAR_LIMIT
    ),
    afterFragment: createCompactPreview(
      insertedFragment,
      CHANGE_FRAGMENT_CHAR_LIMIT
    )
  };
}

function formatSnapshotSummary(snapshot) {
  if (!snapshot) {
    return "unavailable";
  }

  if (snapshot.kind === "file") {
    return `${snapshot.extension || "file"} | ${Number(snapshot.sizeBytes || 0).toLocaleString()} bytes | ${snapshot.preview || "binary or large file"}`;
  }

  const parts = [
    pluralize(Number(snapshot.lineCount || 0), "line"),
    `${Number(snapshot.charCount || 0).toLocaleString()} chars`,
    `hash ${snapshot.hash || "unknown"}`
  ];
  if (snapshot.preview) {
    parts.push(`preview: "${snapshot.preview}"`);
  }
  return parts.join(" | ");
}

function summarizeGitStatusLines(statusLines = []) {
  const counts = {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
    conflicted: 0
  };

  for (const line of statusLines) {
    const code = String(line || "").slice(0, 2);
    if (!code) {
      continue;
    }

    if (code === "??") {
      counts.untracked += 1;
      continue;
    }

    if (code.includes("U") || code === "AA" || code === "DD") {
      counts.conflicted += 1;
      continue;
    }

    if (code.includes("R")) {
      counts.renamed += 1;
      continue;
    }

    if (code.includes("A")) {
      counts.added += 1;
      continue;
    }

    if (code.includes("D")) {
      counts.deleted += 1;
      continue;
    }

    if (code.includes("C")) {
      counts.copied += 1;
      continue;
    }

    if (code.includes("M")) {
      counts.modified += 1;
    }
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => pluralize(count, label))
    .join(", ");
}

function sanitizeOutputRelativePath(inputPath) {
  const raw = String(inputPath || "").trim().replace(/\\/g, "/");
  if (!raw) {
    return DEFAULT_OUTPUT_RELATIVE_PATH;
  }

  const normalized = raw.replace(/^\.\/+/, "");
  if (
    path.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return DEFAULT_OUTPUT_RELATIVE_PATH;
  }

  return normalized;
}

class WorkspaceMemoryService {
  constructor(context) {
    this.context = context || null;
    this.state = this._loadState();
    this._pendingWorkspaceRefresh = new Set();
    this._refreshTimer = null;
    this._pendingSaves = new Map();
  }

  async initialize() {
    if (typeof vscode.workspace.onWillSaveTextDocument === "function") {
      this.context?.subscriptions?.push(
        vscode.workspace.onWillSaveTextDocument((event) => {
          this._handleWillSaveDocument(event);
        })
      );
    }

    if (typeof vscode.workspace.onDidSaveTextDocument === "function") {
      this.context?.subscriptions?.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
          this._handleDocumentSave(document);
        })
      );
    }

    if (typeof vscode.workspace.onDidCreateFiles === "function") {
      this.context?.subscriptions?.push(
        vscode.workspace.onDidCreateFiles((event) => {
          this._handleCreatedFiles(event);
        })
      );
    }

    if (typeof vscode.workspace.onDidDeleteFiles === "function") {
      this.context?.subscriptions?.push(
        vscode.workspace.onDidDeleteFiles((event) => {
          this._handleDeletedFiles(event);
        })
      );
    }

    if (typeof vscode.workspace.onDidRenameFiles === "function") {
      this.context?.subscriptions?.push(
        vscode.workspace.onDidRenameFiles((event) => {
          this._handleRenamedFiles(event);
        })
      );
    }

    if (this.isEnabled()) {
      await this.refreshAllNow("startup");
    }
  }

  dispose() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  isEnabled() {
    return vscode.workspace
      .getConfiguration("codeJanitor.assistant.workspaceMemory")
      .get("enabled", true);
  }

  getAutoRefreshDelayMs() {
    const configured = Number(
      vscode.workspace
        .getConfiguration("codeJanitor.assistant.workspaceMemory")
        .get("autoRefreshDelay", DEFAULT_REFRESH_DELAY_MS)
    );
    return Number.isFinite(configured) && configured >= 250
      ? configured
      : DEFAULT_REFRESH_DELAY_MS;
  }

  getMaxRecentChanges() {
    const configured = Number(
      vscode.workspace
        .getConfiguration("codeJanitor.assistant.workspaceMemory")
        .get("maxRecentChanges", DEFAULT_MAX_RECENT_CHANGES)
    );
    return Number.isFinite(configured) && configured >= 5
      ? Math.floor(configured)
      : DEFAULT_MAX_RECENT_CHANGES;
  }

  shouldIncludeGitHub() {
    return vscode.workspace
      .getConfiguration("codeJanitor.assistant.workspaceMemory")
      .get("includeGitHub", true);
  }

  getOutputRelativePath() {
    const configured = vscode.workspace
      .getConfiguration("codeJanitor.assistant.workspaceMemory")
      .get("outputPath", DEFAULT_OUTPUT_RELATIVE_PATH);
    return sanitizeOutputRelativePath(configured);
  }

  async refreshAllNow(reason = "manual", options = {}) {
    const force = options.force === true;
    if (!force && !this.isEnabled()) {
      return [];
    }

    const workspaces = this._getWorkspaceRoots();
    const results = [];
    for (const workspaceRoot of workspaces) {
      const result = await this.refreshWorkspaceMemory(workspaceRoot, reason);
      if (result) {
        results.push(result);
      }
    }
    return results;
  }

  async refreshWorkspaceMemory(workspaceRoot, reason = "manual") {
    if (!workspaceRoot) {
      return null;
    }

    const workspaceState = this._getWorkspaceState(workspaceRoot);
    const snapshot = await this._buildWorkspaceSnapshot(
      workspaceRoot,
      workspaceState,
      reason
    );
    const markdown = this._renderWorkspaceMemory(snapshot);
    const relativePath = this.getOutputRelativePath();
    const outputPath = path.join(workspaceRoot, relativePath);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, markdown, "utf8");

    workspaceState.lastGeneratedAt = Date.now();
    workspaceState.lastGenerationReason = reason;
    workspaceState.lastOutputPath = relativePath;
    this._persistState();

    return {
      workspaceRoot,
      outputPath,
      relativePath
    };
  }

  async openWorkspaceMemory(workspaceRoot = null) {
    const targetWorkspace = workspaceRoot || this._getPreferredWorkspaceRoot();
    if (!targetWorkspace) {
      return null;
    }

    const outputPath = path.join(targetWorkspace, this.getOutputRelativePath());
    if (!fsSync.existsSync(outputPath)) {
      await this.refreshWorkspaceMemory(targetWorkspace, "open");
    }

    if (
      typeof vscode.workspace.openTextDocument !== "function" ||
      typeof vscode.window.showTextDocument !== "function"
    ) {
      return outputPath;
    }

    const document = await vscode.workspace.openTextDocument(outputPath);
    await vscode.window.showTextDocument(document, { preview: false });
    return outputPath;
  }

  _loadState() {
    const savedState = this.context?.globalState?.get?.(
      WORKSPACE_MEMORY_STATE_KEY,
      null
    );
    if (savedState && typeof savedState === "object") {
      return {
        workspaces:
          savedState.workspaces && typeof savedState.workspaces === "object"
            ? savedState.workspaces
            : {}
      };
    }
    return { workspaces: {} };
  }

  _persistState() {
    this.context?.globalState?.update?.(WORKSPACE_MEMORY_STATE_KEY, this.state);
  }

  _getWorkspaceState(workspaceRoot) {
    if (!this.state.workspaces[workspaceRoot]) {
      this.state.workspaces[workspaceRoot] = {
        recentChanges: [],
        trackedFiles: {},
        lastGeneratedAt: 0,
        lastGenerationReason: "",
        lastOutputPath: this.getOutputRelativePath()
      };
    }
    if (
      !this.state.workspaces[workspaceRoot].trackedFiles ||
      typeof this.state.workspaces[workspaceRoot].trackedFiles !== "object"
    ) {
      this.state.workspaces[workspaceRoot].trackedFiles = {};
    }
    return this.state.workspaces[workspaceRoot];
  }

  _getWorkspaceRoots() {
    const roots = new Set();
    const preferred = this._getPreferredWorkspaceRoot();
    if (preferred) {
      roots.add(preferred);
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
      if (folder?.uri?.fsPath) {
        roots.add(folder.uri.fsPath);
      }
    }

    return Array.from(roots);
  }

  _getPreferredWorkspaceRoot() {
    const activeEditor = vscode.window.activeTextEditor || null;
    if (activeEditor?.document?.uri?.scheme === "file") {
      const activeWorkspace = vscode.workspace.getWorkspaceFolder?.(
        activeEditor.document.uri
      )?.uri?.fsPath;
      if (activeWorkspace) {
        return activeWorkspace;
      }
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;
  }

  _getWorkspaceRootForFile(filePath) {
    if (!filePath) {
      return null;
    }
    const normalizedFilePath = path.resolve(String(filePath || ""));
    for (const folder of vscode.workspace.workspaceFolders || []) {
      const workspaceRoot = folder?.uri?.fsPath;
      if (!workspaceRoot) continue;
      const relativePath = path.relative(workspaceRoot, normalizedFilePath);
      if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
        return workspaceRoot;
      }
      if (normalizedFilePath === path.resolve(workspaceRoot)) {
        return workspaceRoot;
      }
    }
    return null;
  }

  _toWorkspaceRelativePath(workspaceRoot, filePath) {
    if (!workspaceRoot || !filePath) {
      return null;
    }

    const resolvedWorkspace = path.resolve(workspaceRoot);
    const resolvedPath = path.resolve(filePath);
    const relativePath = path.relative(resolvedWorkspace, resolvedPath);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      return null;
    }

    return relativePath.replace(/\\/g, "/");
  }

  _recordWorkspaceChange(workspaceRoot, change) {
    if (!workspaceRoot || !change) {
      return;
    }

    const workspaceState = this._getWorkspaceState(workspaceRoot);
    workspaceState.recentChanges = [
      {
        ...change,
        recordedAt: change.recordedAt || Date.now()
      }
    ].concat(
      (workspaceState.recentChanges || []).filter((entry) => {
        return !(
          entry.type === change.type &&
          entry.path === change.path &&
          entry.toPath === change.toPath &&
          Math.abs(Number(entry.recordedAt || 0) - Number(change.recordedAt || Date.now())) <
            250
        );
      })
    );

    workspaceState.recentChanges = workspaceState.recentChanges.slice(
      0,
      this.getMaxRecentChanges()
    );
    this._persistState();
  }

  _buildPendingSaveKey(workspaceRoot, relativePath) {
    return `${workspaceRoot}::${relativePath}`;
  }

  _getTrackedFileSnapshot(workspaceRoot, relativePath) {
    const workspaceState = this._getWorkspaceState(workspaceRoot);
    return workspaceState.trackedFiles?.[relativePath] || null;
  }

  _rememberTrackedFile(workspaceRoot, relativePath, snapshot) {
    if (!workspaceRoot || !relativePath || !snapshot) {
      return;
    }

    const workspaceState = this._getWorkspaceState(workspaceRoot);
    workspaceState.trackedFiles[relativePath] = {
      ...snapshot,
      updatedAt: snapshot.updatedAt || Date.now()
    };

    const entries = Object.entries(workspaceState.trackedFiles).sort(
      (a, b) =>
        Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0) ||
        a[0].localeCompare(b[0])
    );
    workspaceState.trackedFiles = Object.fromEntries(
      entries.slice(0, MAX_TRACKED_FILE_SNAPSHOTS)
    );
    this._persistState();
  }

  _forgetTrackedFile(workspaceRoot, relativePath) {
    if (!workspaceRoot || !relativePath) {
      return;
    }

    const workspaceState = this._getWorkspaceState(workspaceRoot);
    if (workspaceState.trackedFiles?.[relativePath]) {
      delete workspaceState.trackedFiles[relativePath];
      this._persistState();
    }
  }

  _moveTrackedFile(workspaceRoot, fromPath, toPath, nextSnapshot = null) {
    if (!workspaceRoot || !fromPath || !toPath) {
      return null;
    }

    const previousSnapshot = this._getTrackedFileSnapshot(workspaceRoot, fromPath);
    this._forgetTrackedFile(workspaceRoot, fromPath);
    if (nextSnapshot || previousSnapshot) {
      this._rememberTrackedFile(
        workspaceRoot,
        toPath,
        nextSnapshot || {
          ...previousSnapshot,
          updatedAt: Date.now()
        }
      );
    }
    return previousSnapshot;
  }

  _queueRefresh(workspaceRoot) {
    if (!workspaceRoot || !this.isEnabled()) {
      return;
    }

    this._pendingWorkspaceRefresh.add(workspaceRoot);
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }

    this._refreshTimer = setTimeout(async () => {
      const pendingRoots = Array.from(this._pendingWorkspaceRefresh);
      this._pendingWorkspaceRefresh.clear();
      this._refreshTimer = null;

      for (const root of pendingRoots) {
        try {
          await this.refreshWorkspaceMemory(root, "tracked-change");
        } catch (error) {
          console.warn(
            `[WorkspaceMemory] Failed to refresh workspace memory for ${root}: ${error.message}`
          );
        }
      }
    }, this.getAutoRefreshDelayMs());
  }

  _handleWillSaveDocument(event) {
    const document = event?.document || event;
    if (!document) {
      return;
    }

    this._capturePendingSave(document).catch((error) => {
      console.warn(
        `[WorkspaceMemory] Failed to capture pending save metadata: ${error.message}`
      );
    });
  }

  async _createFileSnapshot(filePath) {
    if (!filePath) {
      return null;
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return null;
      }

      const extension = path.extname(filePath).toLowerCase() || "[no extension]";
      if (stat.size > MAX_TEXT_SNAPSHOT_BYTES || BINARY_EXTENSIONS.has(extension)) {
        return {
          kind: "file",
          extension,
          sizeBytes: stat.size,
          preview: "Binary or large file; content preview omitted.",
          updatedAt: Number(stat.mtimeMs || Date.now())
        };
      }

      try {
        const text = await fs.readFile(filePath, "utf8");
        return {
          ...createTextSnapshot(text),
          extension,
          sizeBytes: stat.size,
          updatedAt: Number(stat.mtimeMs || Date.now())
        };
      } catch {
        return {
          kind: "file",
          extension,
          sizeBytes: stat.size,
          preview: "File snapshot available but text preview could not be read.",
          updatedAt: Number(stat.mtimeMs || Date.now())
        };
      }
    } catch {
      return null;
    }
  }

  async _capturePendingSave(document) {
    if (!document || document.isUntitled || document.uri?.scheme !== "file") {
      return;
    }

    const workspaceRoot = this._getWorkspaceRootForFile(document.fileName);
    const relativePath = this._toWorkspaceRelativePath(
      workspaceRoot,
      document.fileName
    );
    if (!workspaceRoot || !relativePath || isIgnoredWorkspacePath(relativePath)) {
      return;
    }

    const nextText =
      typeof document.getText === "function" ? document.getText() : "";
    const existedBeforeSave = fsSync.existsSync(document.fileName);
    let previousText = null;

    if (existedBeforeSave) {
      try {
        previousText = await fs.readFile(document.fileName, "utf8");
      } catch {
        previousText = null;
      }
    }

    const diff = summarizeContentChange(previousText || "", nextText);
    const key = this._buildPendingSaveKey(workspaceRoot, relativePath);
    this._pendingSaves.set(key, {
      type: existedBeforeSave ? "save" : "create",
      path: relativePath,
      lineCount: countLines(nextText),
      existedBeforeSave,
      summary: diff
        ? diff.summary
        : existedBeforeSave
          ? "Saved without a textual diff."
          : "Created file.",
      before: existedBeforeSave ? createTextSnapshot(previousText || "") : null,
      after: createTextSnapshot(nextText),
      diff,
      recordedAt: Date.now()
    });
  }

  _handleDocumentSave(document) {
    if (!document || document.isUntitled || document.uri?.scheme !== "file") {
      return;
    }

    const workspaceRoot = this._getWorkspaceRootForFile(document.fileName);
    const relativePath = this._toWorkspaceRelativePath(
      workspaceRoot,
      document.fileName
    );
    if (!workspaceRoot || !relativePath || isIgnoredWorkspacePath(relativePath)) {
      return;
    }

    const lineCount =
      typeof document.getText === "function"
        ? countLines(document.getText())
        : undefined;
    const key = this._buildPendingSaveKey(workspaceRoot, relativePath);
    const pending = this._pendingSaves.get(key) || null;
    if (pending) {
      this._pendingSaves.delete(key);
    }

    const changeRecord = pending
      ? {
          ...pending,
          lineCount: pending.after?.lineCount || lineCount || pending.lineCount
        }
      : {
          type: "save",
          path: relativePath,
          lineCount
        };

    this._recordWorkspaceChange(workspaceRoot, changeRecord);
    if (changeRecord.after) {
      this._rememberTrackedFile(workspaceRoot, relativePath, changeRecord.after);
    }
    this._queueRefresh(workspaceRoot);
  }

  async _handleCreatedFiles(event) {
    for (const file of event?.files || []) {
      const filePath = file?.fsPath;
      const workspaceRoot = this._getWorkspaceRootForFile(filePath);
      const relativePath = this._toWorkspaceRelativePath(workspaceRoot, filePath);
      if (!workspaceRoot || !relativePath || isIgnoredWorkspacePath(relativePath)) {
        continue;
      }

      const pendingKey = this._buildPendingSaveKey(workspaceRoot, relativePath);
      const pending = this._pendingSaves.get(pendingKey);
      if (pending && pending.existedBeforeSave === false) {
        continue;
      }

      const afterSnapshot = await this._createFileSnapshot(filePath);
      this._recordWorkspaceChange(workspaceRoot, {
        type: "create",
        path: relativePath,
        summary: "Created file.",
        after: afterSnapshot
      });
      if (afterSnapshot) {
        this._rememberTrackedFile(workspaceRoot, relativePath, afterSnapshot);
      }
      this._queueRefresh(workspaceRoot);
    }
  }

  _handleDeletedFiles(event) {
    for (const file of event?.files || []) {
      const filePath = file?.fsPath;
      const workspaceRoot = this._getWorkspaceRootForFile(filePath);
      const relativePath = this._toWorkspaceRelativePath(workspaceRoot, filePath);
      if (!workspaceRoot || !relativePath || isIgnoredWorkspacePath(relativePath)) {
        continue;
      }
      const beforeSnapshot = this._getTrackedFileSnapshot(workspaceRoot, relativePath);
      this._recordWorkspaceChange(workspaceRoot, {
        type: "delete",
        path: relativePath,
        summary: "Deleted file.",
        before: beforeSnapshot
      });
      this._forgetTrackedFile(workspaceRoot, relativePath);
      this._queueRefresh(workspaceRoot);
    }
  }

  async _handleRenamedFiles(event) {
    for (const file of event?.files || []) {
      const oldWorkspaceRoot = this._getWorkspaceRootForFile(file.oldUri?.fsPath);
      const newWorkspaceRoot = this._getWorkspaceRootForFile(file.newUri?.fsPath);
      const workspaceRoot = newWorkspaceRoot || oldWorkspaceRoot;
      const oldRelativePath = this._toWorkspaceRelativePath(
        oldWorkspaceRoot,
        file.oldUri?.fsPath
      );
      const newRelativePath = this._toWorkspaceRelativePath(
        newWorkspaceRoot,
        file.newUri?.fsPath
      );

      if (
        !workspaceRoot ||
        !oldRelativePath ||
        !newRelativePath ||
        isIgnoredWorkspacePath(oldRelativePath) ||
        isIgnoredWorkspacePath(newRelativePath)
      ) {
        continue;
      }

      const afterSnapshot = await this._createFileSnapshot(file.newUri?.fsPath);
      const beforeSnapshot =
        workspaceRoot === oldWorkspaceRoot
          ? this._moveTrackedFile(
              workspaceRoot,
              oldRelativePath,
              newRelativePath,
              afterSnapshot
            )
          : this._getTrackedFileSnapshot(oldWorkspaceRoot, oldRelativePath);

      if (workspaceRoot !== oldWorkspaceRoot && oldWorkspaceRoot) {
        this._forgetTrackedFile(oldWorkspaceRoot, oldRelativePath);
      }
      if (workspaceRoot !== oldWorkspaceRoot && afterSnapshot) {
        this._rememberTrackedFile(workspaceRoot, newRelativePath, afterSnapshot);
      }

      this._recordWorkspaceChange(workspaceRoot, {
        type: "rename",
        path: oldRelativePath,
        toPath: newRelativePath,
        summary: "Renamed file.",
        before: beforeSnapshot,
        after: afterSnapshot
      });
      this._queueRefresh(workspaceRoot);
    }
  }

  async _buildWorkspaceSnapshot(workspaceRoot, workspaceState, reason) {
    const workspaceStats = await this._scanWorkspace(workspaceRoot);
    const graphifySnapshot = await this._getGraphifySnapshot(workspaceRoot);
    const gitSnapshot = await this._getGitStatusSnapshot(workspaceRoot);
    const githubSnapshot = await this._getGitHubSnapshot(workspaceRoot);
    const activeFile = this._getActiveWorkspaceFile(workspaceRoot);
    const recentChanges = Array.isArray(workspaceState.recentChanges)
      ? workspaceState.recentChanges.slice(0, MAX_RENDERED_CHANGES)
      : [];

    const hotFileCounts = new Map();
    for (const change of workspaceState.recentChanges || []) {
      const key = change.toPath || change.path;
      if (!key) continue;
      hotFileCounts.set(key, (hotFileCounts.get(key) || 0) + 1);
    }

    const hotFiles = Array.from(hotFileCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_RENDERED_HOT_FILES)
      .map(([filePath, count]) => ({ filePath, count }));

    const changeTypeCounts = { save: 0, create: 0, delete: 0, rename: 0 };
    for (const change of workspaceState.recentChanges || []) {
      if (changeTypeCounts[change.type] !== undefined) {
        changeTypeCounts[change.type] += 1;
      }
    }

    return {
      generatedAt: Date.now(),
      reason,
      workspaceRoot,
      workspaceName: path.basename(workspaceRoot),
      outputRelativePath: this.getOutputRelativePath(),
      activeFile,
      recentChanges,
      hotFiles,
      currentStack: {
        lastActivityAt: workspaceState.recentChanges?.[0]?.recordedAt || null,
        trackedChangeCount: (workspaceState.recentChanges || []).length,
        trackedFileSnapshotCount: Object.keys(workspaceState.trackedFiles || {})
          .length,
        changeTypeCounts
      },
      workspaceStats,
      graphifySnapshot,
      gitSnapshot,
      githubSnapshot
    };
  }

  _getActiveWorkspaceFile(workspaceRoot) {
    const activeEditor = vscode.window.activeTextEditor || null;
    if (!activeEditor?.document?.fileName) {
      return null;
    }

    return this._toWorkspaceRelativePath(workspaceRoot, activeEditor.document.fileName);
  }

  async _scanWorkspace(workspaceRoot) {
    const topLevelCounts = new Map();
    const fileTypeCounts = new Map();
    const keyFiles = [];
    let totalFiles = 0;

    const visitDirectory = async (directoryPath) => {
      let entries = [];
      try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        const relativePath = this._toWorkspaceRelativePath(workspaceRoot, fullPath);
        if (!relativePath || isIgnoredWorkspacePath(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await visitDirectory(fullPath);
          continue;
        }

        totalFiles += 1;
        const normalizedRelativePath = relativePath.replace(/\\/g, "/");
        const topLevel = normalizedRelativePath.includes("/")
          ? normalizedRelativePath.split("/")[0]
          : "[root]";
        const extension = path.extname(entry.name).toLowerCase() || "[no extension]";

        topLevelCounts.set(topLevel, (topLevelCounts.get(topLevel) || 0) + 1);
        fileTypeCounts.set(extension, (fileTypeCounts.get(extension) || 0) + 1);

        const loweredRelativePath = normalizedRelativePath.toLowerCase();
        const loweredName = entry.name.toLowerCase();
        if (
          KEY_FILE_NAMES.has(loweredRelativePath) ||
          KEY_FILE_NAMES.has(loweredName)
        ) {
          keyFiles.push(normalizedRelativePath);
        }
      }
    };

    await visitDirectory(workspaceRoot);

    return {
      totalFiles,
      topLevel: Array.from(topLevelCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_RENDERED_TOP_LEVEL),
      fileTypes: Array.from(fileTypeCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_RENDERED_FILE_TYPES),
      keyFiles: keyFiles.sort().slice(0, MAX_RENDERED_KEY_FILES)
    };
  }

  async _getGraphifySnapshot(workspaceRoot) {
    const reportPath = path.join(workspaceRoot, "graphify-out", "GRAPH_REPORT.md");
    const graphPath = path.join(workspaceRoot, "graphify-out", "graph.json");
    if (!fsSync.existsSync(reportPath)) {
      return {
        reportAvailable: false,
        graphAvailable: fsSync.existsSync(graphPath),
        highlights: ""
      };
    }

    try {
      const reportText = await fs.readFile(reportPath, "utf8");
      return {
        reportAvailable: true,
        graphAvailable: fsSync.existsSync(graphPath),
        highlights: extractGraphReportHighlights(reportText)
      };
    } catch {
      return {
        reportAvailable: false,
        graphAvailable: fsSync.existsSync(graphPath),
        highlights: ""
      };
    }
  }

  async _runGitCommand(workspaceRoot, args) {
    return new Promise((resolve) => {
      execFile(
        "git",
        args,
        {
          cwd: workspaceRoot,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              error: String(stderr || error.message || "").trim()
            });
            return;
          }

          resolve({
            success: true,
            output: String(stdout || "").trim()
          });
        }
      );
    });
  }

  async _getGitStatusSnapshot(workspaceRoot) {
    const branchResult = await this._runGitCommand(workspaceRoot, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]);
    const headResult = await this._runGitCommand(workspaceRoot, [
      "log",
      "-1",
      "--pretty=%cs %h %s"
    ]);
    const statusResult = await this._runGitCommand(workspaceRoot, [
      "status",
      "--short"
    ]);

    if (!branchResult.success && !statusResult.success) {
      return {
        available: false,
        error: branchResult.error || statusResult.error || "git is unavailable"
      };
    }

    const allStatusLines = statusResult.success
      ? statusResult.output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [];

    return {
      available: true,
      branch: branchResult.success ? branchResult.output : "unknown",
      headSummary: headResult.success ? headResult.output : "",
      statusLines: allStatusLines.slice(0, MAX_RENDERED_GIT_STATUS),
      statusSummary: summarizeGitStatusLines(allStatusLines),
      changedFileCount: allStatusLines.length,
      statusTruncated:
        statusResult.success && allStatusLines.length > MAX_RENDERED_GIT_STATUS,
      error:
        !statusResult.success && statusResult.error
          ? statusResult.error
          : null
    };
  }

  async _getGitHubSnapshot(workspaceRoot) {
    if (!this.shouldIncludeGitHub()) {
      return {
        available: false,
        error: "GitHub enrichment is disabled in settings."
      };
    }

    try {
      const result = await fetchGitHubContext(
        { mode: "repo" },
        workspaceRoot,
        { context: this.context }
      );
      return {
        available: true,
        summary: truncateText(result.summary, GITHUB_SUMMARY_CHAR_LIMIT)
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  _renderWorkspaceMemory(snapshot) {
    const lines = [
      "# Workspace Memory",
      "",
      "This file is maintained automatically by Code Janitor so Claude, Codex, Bob, and any other AI agent can reuse repo context without rescanning everything from scratch.",
      "",
      `Generated: ${formatIsoTimestamp(snapshot.generatedAt)}`,
      `Workspace: ${snapshot.workspaceName}`,
      `Workspace root: ${snapshot.workspaceRoot}`,
      `Refresh reason: ${snapshot.reason}`,
      `Output path: ${snapshot.outputRelativePath}`,
      "",
      "## Handoff Guidance",
      "- Read `graphify-out/GRAPH_REPORT.md` first when the request is about architecture, dependencies, file ownership, or codebase navigation.",
      "- Use this memory file for recent activity, hot files, Git-aware status, and GitHub-enriched project context.",
      "- Refresh this file with the `Code Janitor: Refresh Workspace Memory` command after significant edits or branch changes.",
      "",
      "## Repository Blueprint",
      "- Audience: any AI agent working in this repository can treat this file as the current handoff ledger.",
      `- Graphify report: ${
        snapshot.graphifySnapshot.reportAvailable
          ? "available at `graphify-out/GRAPH_REPORT.md`"
          : "not available yet"
      }`,
      `- Graphify graph: ${
        snapshot.graphifySnapshot.graphAvailable
          ? "available at `graphify-out/graph.json`"
          : "not available yet"
      }`,
      `- Last activity: ${
        snapshot.currentStack.lastActivityAt
          ? formatIsoTimestamp(snapshot.currentStack.lastActivityAt)
          : "no tracked activity yet"
      }`,
      "",
      "## Current Workspace",
      `- Active file: ${snapshot.activeFile || "No active file detected"}`,
      `- Tracked files in snapshot: ${snapshot.workspaceStats.totalFiles}`,
      `- Top-level areas: ${
        snapshot.workspaceStats.topLevel.length > 0
          ? snapshot.workspaceStats.topLevel
              .map(([name, count]) => `${name} (${count})`)
              .join(", ")
          : "none"
      }`,
      `- Primary file types: ${
        snapshot.workspaceStats.fileTypes.length > 0
          ? snapshot.workspaceStats.fileTypes
              .map(([name, count]) => `${name} (${count})`)
              .join(", ")
          : "none"
      }`,
      `- Key files: ${
        snapshot.workspaceStats.keyFiles.length > 0
          ? snapshot.workspaceStats.keyFiles.join(", ")
          : "none detected"
      }`,
      "",
      "## Current Stack",
      `- Logged change events: ${snapshot.currentStack.trackedChangeCount}`,
      `- Change mix: ${
        Object.entries(snapshot.currentStack.changeTypeCounts)
          .filter(([, count]) => count > 0)
          .map(([label, count]) => `${label} (${count})`)
          .join(", ") || "none yet"
      }`,
      `- Remembered file snapshots: ${snapshot.currentStack.trackedFileSnapshotCount}`,
      `- Working tree summary: ${
        snapshot.gitSnapshot.available
          ? snapshot.gitSnapshot.statusSummary ||
            (snapshot.gitSnapshot.changedFileCount > 0
              ? `${snapshot.gitSnapshot.changedFileCount} changed file(s)`
              : "clean")
          : snapshot.gitSnapshot.error || "git is unavailable"
      }`,
      "",
      "## Recent Changes"
    ];

    if (snapshot.recentChanges.length === 0) {
      lines.push("- No tracked changes recorded in this session yet.");
    } else {
      for (const change of snapshot.recentChanges) {
        const targetPath = change.type === "rename" && change.toPath
          ? `${change.path} -> ${change.toPath}`
          : change.path;
        lines.push(
          `### ${formatIsoTimestamp(change.recordedAt)} | ${formatChangeLabel(change)} | ${targetPath}`
        );
        if (change.summary) {
          lines.push(`- Summary: ${change.summary}`);
        }
        if (change.before) {
          lines.push(`- Before: ${formatSnapshotSummary(change.before)}`);
        }
        if (change.after) {
          lines.push(`- After: ${formatSnapshotSummary(change.after)}`);
        }
        if (change.diff?.beforeFragment) {
          lines.push(`- Previous fragment: "${change.diff.beforeFragment}"`);
        }
        if (change.diff?.afterFragment) {
          lines.push(`- Current fragment: "${change.diff.afterFragment}"`);
        }
        lines.push("");
      }
    }

    lines.push("");
    lines.push("## Hot Files");
    if (snapshot.hotFiles.length === 0) {
      lines.push("- No hotspots yet.");
    } else {
      for (const hotFile of snapshot.hotFiles) {
        lines.push(`- ${hotFile.filePath} (${hotFile.count} tracked changes)`);
      }
    }

    lines.push("");
    lines.push("## Git Snapshot");
    if (!snapshot.gitSnapshot.available) {
      lines.push(`- ${snapshot.gitSnapshot.error || "Git status is unavailable."}`);
    } else {
      lines.push(`- Branch: ${snapshot.gitSnapshot.branch || "unknown"}`);
      if (snapshot.gitSnapshot.headSummary) {
        lines.push(`- HEAD: ${snapshot.gitSnapshot.headSummary}`);
      }
      lines.push(
        `- Working tree summary: ${
          snapshot.gitSnapshot.statusSummary ||
          (snapshot.gitSnapshot.changedFileCount > 0
            ? `${snapshot.gitSnapshot.changedFileCount} changed file(s)`
            : "clean")
        }`
      );
      if (snapshot.gitSnapshot.statusLines.length === 0) {
        lines.push("- Working tree: clean");
      } else {
        for (const line of snapshot.gitSnapshot.statusLines) {
          lines.push(`- ${line}`);
        }
        if (snapshot.gitSnapshot.statusTruncated) {
          lines.push("- Additional git status lines were omitted for brevity.");
        }
      }
      if (snapshot.gitSnapshot.error) {
        lines.push(`- Note: ${snapshot.gitSnapshot.error}`);
      }
    }

    lines.push("");
    lines.push("## GitHub Snapshot");
    if (snapshot.githubSnapshot.available && snapshot.githubSnapshot.summary) {
      lines.push(snapshot.githubSnapshot.summary);
    } else {
      lines.push(
        `GitHub context unavailable: ${
          snapshot.githubSnapshot.error || "no GitHub repository context could be resolved."
        }`
      );
    }

    lines.push("");
    lines.push("## Graphify Snapshot");
    if (snapshot.graphifySnapshot.highlights) {
      lines.push(snapshot.graphifySnapshot.highlights);
    } else {
      lines.push(
        "Graphify report not found. Generate Graphify output if you want architecture-aware memory excerpts here."
      );
    }

    lines.push("");
    lines.push("## Agent Notes");
    lines.push(
      "- If a future task asks what changed recently, start with `Recent Changes`, `Hot Files`, and `Git Snapshot`."
    );
    lines.push(
      "- If a future task asks how the project is organized, combine this file with `graphify-out/GRAPH_REPORT.md`."
    );
    lines.push(
      "- If a future task needs repository-level context, use the GitHub snapshot first, then fetch fresh GitHub data if the request is time-sensitive."
    );

    return `${lines.join("\n").trim()}\n`;
  }
}

module.exports = {
  WorkspaceMemoryService,
  DEFAULT_OUTPUT_RELATIVE_PATH,
  extractGraphReportHighlights,
  isIgnoredWorkspacePath,
  sanitizeOutputRelativePath
};
