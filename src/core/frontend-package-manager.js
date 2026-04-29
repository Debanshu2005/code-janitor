const fs = require("fs");
const path = require("path");
const { builtinModules } = require("module");

const PACKAGE_MANAGER_NAMES = new Set(["npm", "pnpm", "yarn", "bun"]);
const NODE_BUILTIN_PACKAGES = new Set(
  builtinModules.flatMap((name) => [
    name,
    name.replace(/^node:/, "")
  ])
);

function readPackageManifest(workspaceRoot) {
  if (!workspaceRoot) {
    return null;
  }

  const packageJsonPath = path.join(workspaceRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    console.warn(
      `[FrontendPackageManager] Failed to parse ${packageJsonPath}: ${error.message}`
    );
    return null;
  }
}

function collectDeclaredDependencies(packageManifest) {
  const sections = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies"
  ];
  const declared = new Set();

  for (const section of sections) {
    const entries = packageManifest?.[section];
    if (!entries || typeof entries !== "object") {
      continue;
    }

    Object.keys(entries).forEach((name) => declared.add(name));
  }

  return declared;
}

function inferPackageManager(workspaceRoot, packageManifest = readPackageManifest(workspaceRoot)) {
  const declaredPackageManager = normalizePackageManagerName(
    packageManifest?.packageManager
  );
  if (declaredPackageManager) {
    return declaredPackageManager;
  }

  const lockfiles = [
    { file: "bun.lockb", manager: "bun" },
    { file: "bun.lock", manager: "bun" },
    { file: "pnpm-lock.yaml", manager: "pnpm" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "package-lock.json", manager: "npm" },
    { file: "npm-shrinkwrap.json", manager: "npm" }
  ];

  for (const { file, manager } of lockfiles) {
    if (workspaceRoot && fs.existsSync(path.join(workspaceRoot, file))) {
      return manager;
    }
  }

  return "npm";
}

function getAddPackagesCommand(packageManager, packages) {
  const names = normalizePackageList(packages);
  if (names.length === 0) {
    return null;
  }

  switch (packageManager) {
    case "pnpm":
      return `pnpm add ${names.join(" ")}`;
    case "yarn":
      return `yarn add ${names.join(" ")}`;
    case "bun":
      return `bun add ${names.join(" ")}`;
    case "npm":
    default:
      return `npm install ${names.join(" ")}`;
  }
}

function getPackageNameFromSpecifier(specifier) {
  const trimmed = (specifier || "").trim();
  if (!trimmed || trimmed.startsWith(".") || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return null;
  }

  if (trimmed.startsWith("@")) {
    const parts = trimmed.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : trimmed;
  }

  return trimmed.split("/")[0];
}

function isNodeBuiltinPackage(packageName) {
  const normalized = (packageName || "").replace(/^node:/, "");
  return NODE_BUILTIN_PACKAGES.has(packageName) || NODE_BUILTIN_PACKAGES.has(normalized);
}

function normalizePackageManagerName(packageManagerValue) {
  if (!packageManagerValue || typeof packageManagerValue !== "string") {
    return null;
  }

  const name = packageManagerValue.split("@")[0].trim().toLowerCase();
  return PACKAGE_MANAGER_NAMES.has(name) ? name : null;
}

function normalizePackageList(packages) {
  return [...new Set((packages || []).filter(Boolean))].sort();
}

module.exports = {
  collectDeclaredDependencies,
  getAddPackagesCommand,
  getPackageNameFromSpecifier,
  inferPackageManager,
  isNodeBuiltinPackage,
  readPackageManifest
};
