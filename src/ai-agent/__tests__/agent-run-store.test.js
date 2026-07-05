/* eslint-env jest */

const {
  AgentRunStore,
  AgentRunTrace,
  sanitizeForRunStore
} = require("../agent-run-store");

describe("AgentRunStore", () => {
  function createContext(initialRuns = undefined) {
    const state = new Map();
    if (initialRuns !== undefined) {
      state.set("codeJanitor.ai.agentRuns", initialRuns);
    }
    return {
      globalState: {
        get: jest.fn((key) => state.get(key)),
        update: jest.fn((key, value) => {
          state.set(key, value);
          return Promise.resolve();
        })
      }
    };
  }

  test("creates, checkpoints, spans, and completes persisted runs", () => {
    const context = createContext();
    const store = new AgentRunStore(context);
    const run = store.createRun({
      workflowName: "chat",
      apiKey: "secret-value"
    });
    const trace = new AgentRunTrace(store, run);
    const span = trace.startSpan("llm_inference", { token: "hidden" });

    trace.checkpoint("prepare_request", { status: "completed" });
    trace.endSpan(span, "completed", { outputChars: 12 });
    trace.complete({ finalIntent: "general" });

    const stored = store.getRun(run.id);
    expect(stored.status).toBe("completed");
    expect(stored.metadata.apiKey).toBe("[redacted]");
    expect(stored.checkpoints).toHaveLength(1);
    expect(stored.spans).toHaveLength(1);
    expect(stored.spans[0].metadata.token).toBe("[redacted]");
    expect(context.globalState.update).toHaveBeenCalled();
  });

  test("loads only valid existing runs up to the configured limit", () => {
    const context = createContext([
      { id: "run_a", status: "completed" },
      null,
      { id: 123 },
      { id: "run_b", status: "failed" }
    ]);
    const store = new AgentRunStore(context, { maxRuns: 1 });

    expect(store.listRuns()).toEqual([
      expect.objectContaining({ id: "run_a" })
    ]);
  });

  test("sanitizes nested secrets and long strings", () => {
    const sanitized = sanitizeForRunStore({
      nested: {
        authorization: "Bearer real-token",
        text: "x".repeat(4_100)
      }
    });

    expect(sanitized.nested.authorization).toBe("[redacted]");
    expect(sanitized.nested.text).toContain("[truncated]");
  });
});
