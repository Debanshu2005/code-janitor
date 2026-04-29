/* eslint-env jest */
const {
  extractReadableContent,
  extractUrls,
  formatFetchedPreview,
  isUrlOnlyMessage
} = require("../web-content-utils");

describe("web-content-utils", () => {
  test("extractUrls returns normalized unique links", () => {
    expect(
      extractUrls(
        "Check https://example.com/docs, then https://example.com/docs and https://openai.com/."
      )
    ).toEqual(["https://example.com/docs", "https://openai.com/"]);
  });

  test("isUrlOnlyMessage detects bare link messages", () => {
    expect(isUrlOnlyMessage("https://example.com/article")).toBe(true);
    expect(isUrlOnlyMessage("Analyze https://example.com/article")).toBe(false);
  });

  test("extractReadableContent converts html into readable text", () => {
    const html = [
      "<html><head><title>Example Page</title><meta name=\"description\" content=\"A short summary.\" /></head>",
      "<body><h1>Hello</h1><p>This is <strong>important</strong>.</p><script>ignored()</script></body></html>"
    ].join("");

    const readable = extractReadableContent(html, "text/html", 500);
    const normalizedText = readable.text.replace(/\s+/g, " ").trim();

    expect(readable.title).toBe("Example Page");
    expect(normalizedText).toContain("A short summary.");
    expect(normalizedText).toContain("Hello This is important.");
    expect(normalizedText).not.toContain("ignored()");
  });

  test("formatFetchedPreview includes redirect and title details", () => {
    const preview = formatFetchedPreview(
      "https://example.com",
      {
        success: true,
        data: "<html><head><title>Doc</title></head><body><p>Body text</p></body></html>",
        size: 120,
        contentType: "text/html",
        finalUrl: "https://example.com/final",
        redirected: true
      },
      500
    );

    expect(preview).toContain("Fetched https://example.com/final");
    expect(preview).toContain("Redirected from: https://example.com");
    expect(preview).toContain("Title: Doc");
    expect(preview).toContain("Body text");
  });
});
