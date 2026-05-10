/* eslint-env jest */
jest.mock(
  "vscode",
  () => ({
    workspace: {
      getConfiguration: jest.fn((section) => {
        if (section === "codeJanitor.ai.selfHealing") {
          return {
            get: jest.fn((key, fallback) => {
              if (key === "enabled") return true;
              if (key === "slowThreshold") return 30000;
              return fallback;
            })
          };
        }

        if (section === "codeJanitor.ai") {
          return {
            get: jest.fn((key, fallback) => {
              if (key === "provider") return "groq";
              if (key === "model") return "llama-3.1-70b-versatile";
              if (key === "timeout") return 300000;
              if (key === "gstackGateMode") return "off";
              return fallback;
            })
          };
        }

        return {
          get: jest.fn((_, fallback) => fallback)
        };
      })
    },
    window: {
      createWebviewPanel: jest.fn(),
      showWarningMessage: jest.fn(),
      showInformationMessage: jest.fn()
    },
    ViewColumn: {
      One: 1
    },
    ConfigurationTarget: {
      Global: 1
    },
    commands: {
      executeCommand: jest.fn()
    }
  }),
  { virtual: true }
);

const PerformanceMonitor = require("../performance-monitor");

describe("PerformanceMonitor", () => {
  test("analyzePerformance reports provider breakdown and recommends enabling the gate for edit reliability issues", () => {
    const monitor = new PerformanceMonitor({
      globalStorageUri: { fsPath: "D:/tmp/code-janitor-tests" }
    });

    monitor.responseHistory = [
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 42000, success: true, timestamp: 1 },
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 38000, success: true, timestamp: 2 },
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 39000, success: false, timestamp: 3 },
      { provider: "ollama", model: "qwen2.5-coder:1.5b", duration: 12000, success: true, timestamp: 4 },
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 41000, success: true, timestamp: 5 }
    ];

    monitor.issueLog = [
      { type: "validation_error", details: "lint failed", timestamp: 11 },
      { type: "file_error", details: "write failed", timestamp: 12 },
      { type: "file_error", details: "patch conflict", timestamp: 13 }
    ];

    const analysis = monitor.analyzePerformance();

    expect(analysis.status).toBe("needs_optimization");
    expect(analysis.providerStats[0]).toMatchObject({
      provider: "groq",
      model: "llama-3.1-70b-versatile",
      count: 4
    });
    expect(analysis.issueCounts).toMatchObject({
      validation_error: 1,
      file_error: 2
    });
    expect(analysis.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "enable_gstack_gate",
          to: "smart"
        })
      ])
    );
  });

  test("returns enriched insufficient-data payload before enough responses exist", () => {
    const monitor = new PerformanceMonitor({
      globalStorageUri: { fsPath: "D:/tmp/code-janitor-tests" }
    });

    monitor.responseHistory = [
      { provider: "groq", model: "llama-3.1-8b-instant", duration: 9000, success: true, timestamp: 1 },
      { provider: "groq", model: "llama-3.1-8b-instant", duration: 11000, success: true, timestamp: 2 }
    ];

    const analysis = monitor.analyzePerformance();

    expect(analysis.status).toBe("insufficient_data");
    expect(analysis.responseCount).toBe(2);
    expect(analysis.settings).toMatchObject({
      gstackGateMode: "off",
      provider: "groq"
    });
  });

  test("builds an auto-heal UI state with a health warning badge when optimization is needed", () => {
    const monitor = new PerformanceMonitor({
      globalStorageUri: { fsPath: "D:/tmp/code-janitor-tests" }
    });

    monitor.responseHistory = [
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 46000, success: true, timestamp: 1 },
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 43000, success: true, timestamp: 2 },
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 47000, success: true, timestamp: 3 },
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 49000, success: false, timestamp: 4 },
      { provider: "groq", model: "llama-3.1-70b-versatile", duration: 52000, success: true, timestamp: 5 }
    ];
    monitor.issueLog = [
      { type: "api_error", details: "gateway timeout", timestamp: 11 },
      { type: "timeout", details: "request timed out", timestamp: 12 }
    ];

    const state = monitor.getAutoHealUiState();

    expect(state).toMatchObject({
      enabled: true,
      status: "needs_optimization"
    });
    expect(state.badge).toMatch(/auto-heal ready|health warning/i);
    expect(state.summary).toContain("recommendation");
    expect(state.healthScore).toBeLessThan(85);
  });
});
