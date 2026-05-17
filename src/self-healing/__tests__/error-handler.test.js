jest.mock(
  "vscode",
  () => ({
    window: {
      showErrorMessage: jest.fn(() => Promise.resolve(undefined)),
      showInformationMessage: jest.fn(() => Promise.resolve(undefined)),
      showWarningMessage: jest.fn(() => Promise.resolve(undefined)),
      showInputBox: jest.fn(() => Promise.resolve(undefined)),
      createWebviewPanel: jest.fn(() => ({
        webview: {
          html: ""
        }
      }))
    }
  }),
  { virtual: true }
);

const SelfDiagnosingErrorHandler = require("../error-handler");

describe("SelfDiagnosingErrorHandler", () => {
  test("returns flat successful results with attempt metadata", async () => {
    const handler = new SelfDiagnosingErrorHandler({});

    const result = await handler.retryWithAutoFix(
      async () => ({
        success: true,
        path: "/workspace/src/app.js",
        relativePath: "src/app.js"
      }),
      { type: "file", filePath: "src/app.js" },
      3
    );

    expect(result).toMatchObject({
      success: true,
      path: "/workspace/src/app.js",
      relativePath: "src/app.js",
      attempts: 1
    });
    expect(result.result).toBeUndefined();
  });
});
