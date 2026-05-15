const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const srcRoot = path.join(projectRoot, "src");

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function getFilesByExtensions(extensions) {
  return walkFiles(srcRoot).filter((filePath) =>
    extensions.includes(path.extname(filePath).toLowerCase())
  );
}

function resolveExistingPath(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(typeof result.status === "number" ? result.status : 1);
}

function runJavaFormatter() {
  const files = getFilesByExtensions([".java"]);
  if (files.length === 0) {
    console.log("No Java files found under src. Skipping google-java-format.");
    return;
  }

  const jarPath = resolveExistingPath([
    path.join(
      projectRoot,
      "formatters",
      "google-java-format",
      "google-java-format.jar"
    ),
    path.join(
      projectRoot,
      "src",
      "core",
      "fixers",
      "google-java-format-1.28.0-all-deps.jar"
    )
  ]);

  if (!jarPath) {
    throw new Error("google-java-format.jar was not found in the repository.");
  }

  runCommand("java", ["-jar", jarPath, "-r", ...files]);
}

function runPythonFormatter() {
  const files = getFilesByExtensions([".py"]);
  if (files.length === 0) {
    console.log("No Python files found under src. Skipping Black.");
    return;
  }

  const blackPath = resolveExistingPath([
    process.platform === "win32"
      ? path.join(
          projectRoot,
          "formatters",
          "python-formatters",
          "venv",
          "Scripts",
          "black.exe"
        )
      : path.join(
          projectRoot,
          "formatters",
          "python-formatters",
          "venv",
          "bin",
          "black"
        )
  ]);

  runCommand(blackPath || "black", files);
}

function runCFormatter() {
  const files = getFilesByExtensions([".c", ".h", ".ino"]);
  if (files.length === 0) {
    console.log("No C/C++/Arduino files found under src. Skipping Uncrustify.");
    return;
  }

  const uncrustifyPath = resolveExistingPath([
    process.platform === "win32"
      ? path.join(
          projectRoot,
          "formatters",
          "uncrustify",
          "bin",
          "uncrustify.exe"
        )
      : path.join(projectRoot, "formatters", "uncrustify", "bin", "uncrustify"),
    process.platform === "win32"
      ? path.join(
          projectRoot,
          "src",
          "core",
          "fixers",
          "uncrustify-0.81.0_f-win64",
          "bin",
          "uncrustify.exe"
        )
      : path.join(
          projectRoot,
          "src",
          "core",
          "fixers",
          "uncrustify-0.81.0_f-win64",
          "bin",
          "uncrustify"
        )
  ]);
  const configPath = path.join(
    projectRoot,
    "src",
    "core",
    "fixers",
    "uncrustify.cfg"
  );

  if (!uncrustifyPath) {
    throw new Error("Uncrustify was not found in the repository.");
  }

  runCommand(uncrustifyPath, ["-c", configPath, "--replace", ...files]);
}

function main() {
  const target = process.argv[2];

  switch (target) {
    case "java":
      runJavaFormatter();
      return;
    case "py":
      runPythonFormatter();
      return;
    case "c":
      runCFormatter();
      return;
    default:
      throw new Error(`Unsupported formatter target: ${target || "(missing)"}`);
  }
}

main();
