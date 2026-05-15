/* eslint-env jest */
const { analyzeCodeQuality, buildFixInsights } = require("../fix-insights");

describe("fix-insights", () => {
  test("builds fix explanations and improves score after a syntax repair", () => {
    const beforeCode = "if x = 5:\n    print('ready')\n";
    const afterCode = "if x == 5:\n    print('ready')\n";

    const insights = buildFixInsights({
      filePath: "example.py",
      beforeCode,
      afterCode,
      syntaxErrorOutput: "SyntaxError: invalid syntax",
      verificationPassed: true,
      knownSyntaxBefore: false,
      knownSyntaxAfter: true
    });

    expect(insights).toBeTruthy();
    expect(insights.quality.after).toBeGreaterThan(insights.quality.before);
    expect(insights.summary).toMatch(/Quality score/);
    expect(insights.sections[0].text).toMatch(/comparison|assignment/i);
    expect(insights.sections[2].text).toMatch(/verification passed/i);
  });

  test("penalizes risky code patterns in the security subscore", () => {
    const safe = analyzeCodeQuality(
      "function greet(name) {\n  return `Hello ${name}`;\n}\n",
      { filePath: "safe.js", knownSyntaxValid: true }
    );
    const risky = analyzeCodeQuality(
      "const password = 'super-secret-token';\neval(userInput);\n",
      { filePath: "risky.js", knownSyntaxValid: true }
    );

    expect(risky.subscores.security).toBeLessThan(safe.subscores.security);
    expect(risky.score).toBeLessThan(safe.score);
  });

  test("returns null when there is no content change", () => {
    expect(
      buildFixInsights({
        filePath: "same.js",
        beforeCode: "const value = 1;\n",
        afterCode: "const value = 1;\n"
      })
    ).toBeNull();
  });
});
