/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

const FrontendValidator = require("../frontend-validator");

function createWorkspace() {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "code-janitor-frontend-validator-")
  );
  fs.writeFileSync(path.join(workspace, "package.json"), "{}\n", "utf8");
  return workspace;
}

function ensureFile(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("FrontendValidator", () => {
  const workspaces = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      fs.rmSync(workspaces.pop(), { recursive: true, force: true });
    }
  });

  test("validate does not create missing files as a side effect", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    const htmlPath = path.join(workspace, "pages", "index.html");
    const cssPath = path.join(workspace, "pages", "styles", "app.css");
    ensureFile(
      htmlPath,
      "<link rel=\"stylesheet\" href=\"./styles/app.css\">\n<script src=\"./scripts/app.js\"></script>\n"
    );

    const validator = new FrontendValidator(
      htmlPath,
      fs.readFileSync(htmlPath, "utf8")
    );
    const result = validator.validate();

    expect(result.hasIssues).toBe(true);
    expect(result.issues).toHaveLength(2);
    expect(fs.existsSync(cssPath)).toBe(false);
    expect(
      fs.existsSync(path.join(workspace, "pages", "scripts", "app.js"))
    ).toBe(false);
  });

  test("html validation handles root-relative assets, srcset, and cache-busted URLs", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    ensureFile(path.join(workspace, "assets", "site.css"), "body {}\n");
    ensureFile(path.join(workspace, "assets", "logo.png"), "png");

    const htmlPath = path.join(workspace, "pages", "index.html");
    const html = [
      "<link rel=\"stylesheet\" href=\"/assets/site.css?v=1\">",
      "<img src=\"/assets/logo.png#hero\" alt=\"Logo\">",
      "<img srcset=\"/assets/logo.png 1x, /assets/logo@2x.png 2x\" alt=\"Responsive logo\">"
    ].join("\n");

    ensureFile(htmlPath, html);

    const result = new FrontendValidator(htmlPath, html).validate();

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].file).toBe("/assets/logo@2x.png");
    expect(result.issues[0].line).toBe(3);
  });

  test("html validation ignores template placeholders and allows workspace-root asset paths", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    ensureFile(path.join(workspace, "src", "ai-agent", "logo.png"), "png");

    const htmlPath = path.join(workspace, "pages", "index.html");
    const html = [
      "<img src=\"__LOGO_URI__\" alt=\"Logo\">",
      "<img src=\"src/ai-agent/logo.png\" alt=\"Workspace logo\">"
    ].join("\n");

    ensureFile(htmlPath, html);

    const result = new FrontendValidator(htmlPath, html).validate();

    expect(result.issues).toEqual([]);
  });

  test("graph context resolves workspace-wide asset paths across nested package roots", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    ensureFile(path.join(workspace, "shared", "logo.png"), "png");
    ensureFile(path.join(workspace, "packages", "app", "package.json"), "{}\n");

    const htmlPath = path.join(
      workspace,
      "packages",
      "app",
      "pages",
      "index.html"
    );
    const html = "<img src=\"shared/logo.png\" alt=\"Workspace logo\">";

    ensureFile(htmlPath, html);

    const withoutGraph = new FrontendValidator(htmlPath, html).validate();
    expect(withoutGraph.issues).toHaveLength(1);

    const withGraph = new FrontendValidator(htmlPath, html, {
      graphRoot: workspace,
      graphData: {
        nodes: [{ path: "shared/logo.png", type: "asset" }],
        edges: []
      }
    }).validate();

    expect(withGraph.issues).toEqual([]);
    expect(withGraph.graphContextUsed).toBe(true);
  });

  test("javascript validation catches local files, missing packages, and ignores aliases or declared deps", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    const appPath = path.join(workspace, "src", "app.js");
    ensureFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        dependencies: {
          react: "^18.0.0"
        }
      }, null, 2)
    );
    ensureFile(
      path.join(workspace, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          paths: {
            "@/*": ["src/*"]
          }
        }
      }, null, 2)
    );
    ensureFile(path.join(workspace, "src", "helper.js"), "export default 1;\n");
    ensureFile(path.join(workspace, "src", "assets", "logo.svg"), "<svg />\n");

    const code = [
      "import helper from \"./helper\";",
      "import React from \"react\";",
      "import { Button } from \"@/components/Button\";",
      "import axios from \"axios\";",
      "export * from \"./missing-export\";",
      "const cfg = require(\"./config\");",
      "const lazy = import(\"./lazy\");",
      "const logo = new URL(\"./assets/logo.svg\", import.meta.url);",
      "const path = require(\"node:path\");"
    ].join("\n");

    ensureFile(appPath, code);

    const result = new FrontendValidator(appPath, code).validate();
    const files = result.issues
      .filter((issue) => issue.type === "missing-file")
      .map((issue) => issue.file)
      .sort();
    const packages = result.issues
      .filter((issue) => issue.type === "missing-package")
      .map((issue) => issue.packageName)
      .sort();

    expect(files).toEqual(["./config", "./lazy", "./missing-export"]);
    expect(packages).toEqual(["axios"]);
  });

  test("createMissingFiles creates placeholders for creatable frontend dependencies", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    const htmlPath = path.join(workspace, "pages", "index.html");
    const html = [
      "<link rel=\"stylesheet\" href=\"./styles/site\">",
      "<script src=\"./generated/app\"></script>"
    ].join("\n");

    ensureFile(htmlPath, html);

    const validator = new FrontendValidator(htmlPath, html);
    const result = validator.validate();
    const creation = validator.createMissingFiles(result.issues);

    expect(creation.createdFiles).toEqual(
      expect.arrayContaining([
        path.join(workspace, "pages", "styles", "site.css"),
        path.join(workspace, "pages", "generated", "app.js")
      ])
    );
    expect(
      fs.existsSync(path.join(workspace, "pages", "styles", "site.css"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(workspace, "pages", "generated", "app.js"))
    ).toBe(true);
  });

  test("flags message listeners that trust event.data without validating the sender", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    const jsPath = path.join(workspace, "src", "panel.js");
    const code = [
      "window.addEventListener(\"message\", function(event) {",
      "  var msg = event.data;",
      "  if (msg.type === \"ready\") {",
      "    console.log(msg.type);",
      "  }",
      "});"
    ].join("\n");

    ensureFile(jsPath, code);

    const result = new FrontendValidator(jsPath, code).validate();

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "security",
          kind: "message-origin-validation",
          severity: "error"
        })
      ])
    );
  });

  test("does not flag message listeners that gate messages through a trusted helper", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    const htmlPath = path.join(workspace, "pages", "index.html");
    const html = [
      "<script>",
      "function getTrustedExtensionMessage(event) {",
      "  return event && event.data && event.data.__codeJanitorToken ? event.data : null;",
      "}",
      "window.addEventListener(\"message\", function(event) {",
      "  var msg = getTrustedExtensionMessage(event);",
      "  if (!msg) return;",
      "  console.log(msg.type);",
      "});",
      "</script>"
    ].join("\n");

    ensureFile(htmlPath, html);

    const result = new FrontendValidator(htmlPath, html).validate();

    expect(
      result.issues.filter((issue) => issue.kind === "message-origin-validation")
    ).toEqual([]);
  });
});
