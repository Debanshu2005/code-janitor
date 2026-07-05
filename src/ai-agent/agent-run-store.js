const crypto = require("crypto");

const DEFAULT_STATE_KEY = "codeJanitor.ai.agentRuns";
const DEFAULT_MAX_RUNS = 25;
const MAX_STRING_CHARS = 4_000;

function createRunId() {
  if (typeof crypto.randomUUID === "function") {
    return `run_${crypto.randomUUID()}`;
  }
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sanitizeForRunStore(value, depth = 0) {
  if (depth > 8) {
    return "[max depth]";
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_CHARS
      ? `${value.slice(0, MAX_STRING_CHARS)}...[truncated]`
      : value;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeForRunStore(item, depth + 1));
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|authorization|api[_-]?key|cookie/i.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = sanitizeForRunStore(item, depth + 1);
  }
  return result;
}

class AgentRunStore {
  constructor(context = null, options = {}) {
    this.context = context || null;
    this.stateKey = options.stateKey || DEFAULT_STATE_KEY;
    this.maxRuns = Number.isFinite(options.maxRuns)
      ? options.maxRuns
      : DEFAULT_MAX_RUNS;
    this.runs = this._loadRuns();
  }

  createRun(metadata = {}) {
    const now = new Date().toISOString();
    const run = {
      id: createRunId(),
      status: "running",
      createdAt: now,
      updatedAt: now,
      metadata: sanitizeForRunStore(metadata),
      checkpoints: [],
      spans: []
    };

    this.runs.unshift(run);
    this._trim();
    this._persist();
    return this._clone(run);
  }

  addCheckpoint(runId, checkpoint = {}) {
    return this._mutateRun(runId, (run) => {
      run.checkpoints.push({
        ts: new Date().toISOString(),
        ...sanitizeForRunStore(checkpoint)
      });
      if (run.checkpoints.length > 100) {
        run.checkpoints.shift();
      }
    });
  }

  addSpan(runId, span = {}) {
    return this._mutateRun(runId, (run) => {
      run.spans.push(sanitizeForRunStore(span));
      if (run.spans.length > 200) {
        run.spans.shift();
      }
    });
  }

  updateRun(runId, patch = {}) {
    return this._mutateRun(runId, (run) => {
      Object.assign(run, sanitizeForRunStore(patch));
    });
  }

  completeRun(runId, patch = {}) {
    return this.updateRun(runId, {
      ...patch,
      status: "completed",
      completedAt: new Date().toISOString()
    });
  }

  failRun(runId, error, patch = {}) {
    return this.updateRun(runId, {
      ...patch,
      status: "failed",
      error: error?.message || String(error || "Unknown error"),
      completedAt: new Date().toISOString()
    });
  }

  getRun(runId) {
    const run = this.runs.find((candidate) => candidate.id === runId);
    return run ? this._clone(run) : null;
  }

  listRuns(limit = this.maxRuns) {
    return this.runs.slice(0, limit).map((run) => this._clone(run));
  }

  clear() {
    this.runs = [];
    this._persist();
  }

  _mutateRun(runId, mutator) {
    const index = this.runs.findIndex((run) => run.id === runId);
    if (index < 0) {
      return null;
    }

    const run = this.runs[index];
    mutator(run);
    run.updatedAt = new Date().toISOString();
    this._persist();
    return this._clone(run);
  }

  _loadRuns() {
    try {
      const raw = this.context?.globalState?.get?.(this.stateKey);
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw
        .filter((run) => run && typeof run === "object" && typeof run.id === "string")
        .slice(0, this.maxRuns);
    } catch (_) {
      return [];
    }
  }

  _persist() {
    try {
      this.context?.globalState?.update?.(this.stateKey, this.runs);
    } catch (_) {
      // Persistence is best-effort; the active run still exists in memory.
    }
  }

  _trim() {
    if (this.runs.length > this.maxRuns) {
      this.runs = this.runs.slice(0, this.maxRuns);
    }
  }

  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
}

class AgentRunTrace {
  constructor(store, run) {
    this.store = store;
    this.runId = run?.id || "";
  }

  checkpoint(name, details = {}) {
    if (!this.store || !this.runId) {
      return;
    }
    this.store.addCheckpoint(this.runId, { name, details });
  }

  startSpan(name, metadata = {}) {
    const spanId = `span_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return {
      id: spanId,
      name,
      startedAt: Date.now(),
      metadata: sanitizeForRunStore(metadata)
    };
  }

  endSpan(span, status = "completed", details = {}) {
    if (!this.store || !this.runId || !span) {
      return;
    }

    this.store.addSpan(this.runId, {
      id: span.id,
      name: span.name,
      status,
      startedAt: new Date(span.startedAt).toISOString(),
      durationMs: Date.now() - span.startedAt,
      metadata: span.metadata,
      details
    });
  }

  complete(details = {}) {
    if (this.store && this.runId) {
      this.store.completeRun(this.runId, { finalDetails: details });
    }
  }

  fail(error, details = {}) {
    if (this.store && this.runId) {
      this.store.failRun(this.runId, error, { finalDetails: details });
    }
  }
}

module.exports = {
  AgentRunStore,
  AgentRunTrace,
  sanitizeForRunStore
};
