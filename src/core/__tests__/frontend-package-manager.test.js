/* eslint-env jest */
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  collectDeclaredDependencies,
  getAddPackagesCommand,
  getPackageNameFromSpecifier,
  inferPackageManager,
  isNodeBuiltinPackage,
  readPackageManifest
} = require("../frontend-package-manager");

function createWorkspace() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "code-janitor-frontend-package-manager-")
  );
}

describe("frontend-package-manager", () => {
  const workspaces = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      fs.rmSync(workspaces.pop(), { recursive: true, force: true });
    }
  });

  test("infers package manager from packageManager field before lockfiles", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);

    fs.writeFileSync(
      path.join(workspace, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.0.0" }, null, 2),
      "utf8"
    );
    fs.writeFileSync(path.join(workspace, "package-lock.json"), "{}\n", "utf8");

    const manifest = readPackageManifest(workspace);
    expect(inferPackageManager(workspace, manifest)).toBe("pnpm");
  });

  test("builds install commands for common package managers", () => {
    expect(getAddPackagesCommand("npm", ["react", "axios"])).toBe(
      "npm install axios react"
    );
    expect(getAddPackagesCommand("pnpm", ["react"])).toBe("pnpm add react");
    expect(getAddPackagesCommand("yarn", ["react"])).toBe("yarn add react");
    expect(getAddPackagesCommand("bun", ["react"])).toBe("bun add react");
  });

  test("extracts package names and ignores node builtins", () => {
    expect(getPackageNameFromSpecifier("@scope/pkg/utils")).toBe("@scope/pkg");
    expect(getPackageNameFromSpecifier("react/jsx-runtime")).toBe("react");
    expect(isNodeBuiltinPackage("node:path")).toBe(true);
    expect(isNodeBuiltinPackage("path")).toBe(true);
  });

  test("collects declared dependencies from multiple manifest sections", () => {
    const declared = collectDeclaredDependencies({
      dependencies: { react: "^18.0.0" },
      devDependencies: { vite: "^5.0.0" },
      peerDependencies: { vue: "^3.0.0" },
      optionalDependencies: { sharp: "^0.33.0" }
    });

    expect([...declared].sort()).toEqual(["react", "sharp", "vite", "vue"]);
  });
});
