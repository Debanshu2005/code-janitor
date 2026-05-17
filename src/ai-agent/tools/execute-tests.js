/**
 * execute-tests.js
 * 
 * Tool for executing tests and generating test reports
 */

const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const vscode = require("../../utils/vscode-shim");
const { runProviderPrompt } = require("../provider-utils");

function execAsync(command, options) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

/**
 * Test framework detection patterns
 */
const TEST_FRAMEWORKS = {
  javascript: {
    jest: {
      pattern: /jest/i,
      command: "npx jest",
      configFiles: [
        "jest.config.js",
        "jest.config.cjs",
        "jest.config.mjs",
        "jest.config.ts",
        "jest.config.json"
      ],
      testPattern: /\.(test|spec)\.(js|ts|jsx|tsx)$/
    },
    mocha: {
      pattern: /mocha/i,
      command: "npx mocha",
      configFiles: [".mocharc.json", ".mocharc.js", ".mocharc.cjs"],
      testPattern: /\.(test|spec)\.(js|ts)$/
    },
    vitest: {
      pattern: /vitest/i,
      command: "npx vitest run",
      configFiles: [
        "vitest.config.js",
        "vitest.config.mjs",
        "vitest.config.cjs",
        "vitest.config.ts"
      ],
      testPattern: /\.(test|spec)\.(js|ts|jsx|tsx)$/
    }
  },
  python: {
    pytest: {
      pattern: /pytest/i,
      command: "pytest --verbose --json-report",
      configFiles: ["pytest.ini", "pyproject.toml"],
      testPattern: /test_.*\.py$|.*_test\.py$/
    },
    unittest: {
      pattern: /unittest/i,
      command: "python -m unittest discover",
      configFiles: [],
      testPattern: /test_.*\.py$/
    }
  },
  java: {
    junit: {
      pattern: /junit/i,
      command: "mvn test",
      configFiles: ["pom.xml"],
      testPattern: /.*Test\.java$/
    },
    gradle: {
      pattern: /gradle/i,
      command: "gradle test",
      configFiles: ["build.gradle"],
      testPattern: /.*Test\.java$/
    }
  }
};

function isAiTestingEnabled() {
  return vscode.workspace
    .getConfiguration("codeJanitor.testing.aiAssist")
    .get("enabled", false);
}

function getAiTestingProvider() {
  return String(
    vscode.workspace
      .getConfiguration("codeJanitor.testing.aiAssist")
      .get("provider", "") || ""
  ).trim();
}

function quoteShellArg(value) {
  return `"${String(value || "").replace(/"/g, '\\"')}"`;
}

function buildTestCommand(framework, testPath) {
  if (!testPath) {
    return framework.command;
  }

  const quotedPath = quoteShellArg(testPath);

  if (framework.name === "jest") {
    return `${framework.command} --runTestsByPath ${quotedPath}`;
  }

  if (framework.name === "vitest") {
    return `${framework.command} ${quotedPath}`;
  }

  if (framework.name === "mocha" || framework.name === "pytest") {
    return `${framework.command} ${quotedPath}`;
  }

  return framework.command;
}

async function cleanupTemporaryTestFiles(temporaryTestPaths, workspaceRoot) {
  const removed = [];
  const failed = [];

  for (const testPath of temporaryTestPaths) {
    const absolutePath = path.isAbsolute(testPath)
      ? testPath
      : path.join(workspaceRoot, testPath);

    try {
      await fs.unlink(absolutePath);
      removed.push(path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/"));
    } catch (error) {
      failed.push({
        path: path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/"),
        error: error.message
      });
    }
  }

  return { removed, failed };
}

async function generateAiTestingReview(
  options,
  workspaceRoot,
  frameworkName,
  testFiles,
  results,
  executionContext = {}
) {
  if (!isAiTestingEnabled() || !executionContext?.agent || !executionContext?.context) {
    return null;
  }

  const review = await runProviderPrompt({
    context: executionContext.context,
    agent: executionContext.agent,
    workspaceRoot,
    preferredProvider: getAiTestingProvider(),
    mode: "fast",
    intent: "review",
    systemOverlay:
      "Return markdown only. Keep it short and practical.",
    prompt:
      "Review these test results and point out likely edge-case coverage gaps. " +
      "Focus on missing scenarios, risky failure patterns, and the next test improvements to make.\n\n" +
      `Framework: ${frameworkName}\n` +
      `Options: ${JSON.stringify(options, null, 2)}\n` +
      `Test files: ${JSON.stringify(testFiles.slice(0, 20), null, 2)}\n` +
      `Results: ${JSON.stringify(results, null, 2)}`
  });

  return review.text || null;
}

/**
 * Detect test framework from package.json or project files
 */
async function detectTestFramework(workspaceRoot, language) {
  const frameworks = TEST_FRAMEWORKS[language];
  if (!frameworks) {
    return null;
  }
  
  // Check package.json for JavaScript/TypeScript
  if (language === "javascript") {
    try {
      const packageJsonPath = path.join(workspaceRoot, "package.json");
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
      
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      const testScript = String(packageJson.scripts?.test || "");
      
      for (const [name, framework] of Object.entries(frameworks)) {
        if (Object.keys(dependencies).some(dep => framework.pattern.test(dep))) {
          return { name, ...framework };
        }
        if (testScript && framework.pattern.test(testScript)) {
          return { name, ...framework };
        }
      }
    } catch (error) {
      // Package.json not found or invalid
    }
  }
  
  // Check for config files
  for (const [name, framework] of Object.entries(frameworks)) {
    for (const configFile of framework.configFiles) {
      try {
        await fs.access(path.join(workspaceRoot, configFile));
        return { name, ...framework };
      } catch (error) {
        // Config file not found
      }
    }
  }
  
  return null;
}

/**
 * Find test files in workspace
 */
async function findTestFiles(workspaceRoot, testPattern) {
  const testFiles = [];
  
  async function scanDirectory(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip node_modules and other common directories
          if (!["node_modules", ".git", "dist", "build", "out"].includes(entry.name)) {
            await scanDirectory(fullPath);
          }
        } else if (entry.isFile() && testPattern.test(entry.name)) {
          testFiles.push(path.relative(workspaceRoot, fullPath));
        }
      }
    } catch (error) {
      // Directory not accessible
    }
  }
  
  await scanDirectory(workspaceRoot);
  return testFiles;
}

/**
 * Execute tests and capture results
 */
async function executeTests(options, workspaceRoot, executionContext = {}) {
  const {
    testPath = null,
    framework = null,
    generateReport = true,
    includeEdgeCases = true,
    temporaryTestPaths = []
  } = options;
  
  try {
    // Detect language from test path or workspace
    const language = detectLanguageFromPath(testPath) || "javascript";
    
    // Detect test framework
    const detectedFramework = framework 
      ? TEST_FRAMEWORKS[language]?.[framework]
        ? { name: framework, ...TEST_FRAMEWORKS[language][framework] }
        : null
      : await detectTestFramework(workspaceRoot, language);
    
    if (!detectedFramework) {
      return {
        success: false,
        error: `No test framework detected for ${language}`
      };
    }
    
    // Find test files
    const testFiles = testPath
      ? [testPath]
      : await findTestFiles(workspaceRoot, detectedFramework.testPattern);
    
    if (testFiles.length === 0) {
      return {
        success: false,
        error: "No test files found"
      };
    }
    
    // Execute tests
    const testCommand = buildTestCommand(detectedFramework, testPath);
    
    const startTime = Date.now();
    let testOutput;
    let testError;
    let commandFailed = false;
    
    try {
      const { stdout, stderr } = await execAsync(testCommand, {
        cwd: workspaceRoot,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
      testOutput = stdout;
      testError = stderr;
    } catch (error) {
      commandFailed = true;
      testOutput = error.stdout || "";
      testError = error.stderr || error.message;
    }
    
    const duration = Date.now() - startTime;
    
    // Parse test results
    const results = parseTestResults(testOutput, testError, detectedFramework.name);
    if (commandFailed && !String(testOutput || "").trim() && results.total === 0) {
      return {
        success: false,
        error: testError || "Test execution failed"
      };
    }
    
    // Generate report if requested
    const aiReview = await generateAiTestingReview(
      options,
      workspaceRoot,
      detectedFramework.name,
      testFiles,
      results,
      executionContext
    ).catch(() => null);

    let report = null;
    if (generateReport) {
      report = await generateTestReport(results, {
        framework: detectedFramework.name,
        duration,
        testFiles,
        workspaceRoot,
        aiReview
      });
    }

    let cleanup = null;
    if (temporaryTestPaths.length > 0 && results.failed === 0) {
      cleanup = await cleanupTemporaryTestFiles(temporaryTestPaths, workspaceRoot);
    }
    
    return {
      success: true,
      framework: detectedFramework.name,
      testFiles,
      results,
      report,
      aiReview,
      duration,
      cleanup,
      summary: {
        total: results.total,
        passed: results.passed,
        failed: results.failed,
        skipped: results.skipped,
        duration
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Detect language from file path
 */
function detectLanguageFromPath(filePath) {
  if (!filePath) return null;
  
  const ext = path.extname(filePath).toLowerCase();
  const extMap = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "javascript",
    ".tsx": "javascript",
    ".py": "python",
    ".java": "java"
  };
  
  return extMap[ext] || null;
}

/**
 * Parse test results from output
 */
function parseTestResults(stdout, stderr, framework) {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: [],
    errors: []
  };
  
  // Parse based on framework
  if (framework === "jest") {
    return parseJestResults(stdout, stderr);
  } else if (framework === "pytest") {
    return parsePytestResults(stdout, stderr);
  } else if (framework === "junit") {
    return parseJUnitResults(stdout, stderr);
  }
  
  // Generic parsing
  const lines = (stdout + "\n" + stderr).split("\n");
  
  for (const line of lines) {
    if (/passed|ok|success/i.test(line)) {
      results.passed++;
      results.total++;
    } else if (/failed|error|fail/i.test(line)) {
      results.failed++;
      results.total++;
      results.errors.push(line.trim());
    } else if (/skipped|pending/i.test(line)) {
      results.skipped++;
      results.total++;
    }
  }
  
  return results;
}

/**
 * Parse Jest test results
 */
function parseJestResults(stdout, stderr) {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: [],
    errors: []
  };
  
  // Look for Jest summary
  const summaryMatch = stdout.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
  if (summaryMatch) {
    results.failed = parseInt(summaryMatch[1]);
    results.passed = parseInt(summaryMatch[2]);
    results.total = parseInt(summaryMatch[3]);
  }
  
  // Extract failed test details
  const failedTests = stdout.match(/●\s+(.+?)(?=\n\n|\n●|$)/gs);
  if (failedTests) {
    results.errors = failedTests.map(test => test.trim());
  }
  
  return results;
}

/**
 * Parse pytest results
 */
function parsePytestResults(stdout, stderr) {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: [],
    errors: []
  };
  
  // Look for pytest summary
  const summaryMatch = stdout.match(/(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?/);
  if (summaryMatch) {
    results.passed = parseInt(summaryMatch[1]) || 0;
    results.failed = parseInt(summaryMatch[2]) || 0;
    results.skipped = parseInt(summaryMatch[3]) || 0;
    results.total = results.passed + results.failed + results.skipped;
  }
  
  return results;
}

/**
 * Parse JUnit results
 */
function parseJUnitResults(stdout, stderr) {
  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    tests: [],
    errors: []
  };
  
  // Look for Maven/Gradle test summary
  const summaryMatch = stdout.match(/Tests run:\s+(\d+),\s+Failures:\s+(\d+),\s+Errors:\s+(\d+),\s+Skipped:\s+(\d+)/);
  if (summaryMatch) {
    results.total = parseInt(summaryMatch[1]);
    const failures = parseInt(summaryMatch[2]);
    const errors = parseInt(summaryMatch[3]);
    results.failed = failures + errors;
    results.skipped = parseInt(summaryMatch[4]);
    results.passed = results.total - results.failed - results.skipped;
  }
  
  return results;
}

/**
 * Generate test report
 */
async function generateTestReport(results, options) {
  const { framework, duration, testFiles, workspaceRoot, aiReview = "" } = options;
  
  const report = {
    timestamp: new Date().toISOString(),
    framework,
    duration,
    testFiles,
    summary: {
      total: results.total,
      passed: results.passed,
      failed: results.failed,
      skipped: results.skipped,
      successRate: results.total > 0 ? ((results.passed / results.total) * 100).toFixed(2) : 0
    },
    details: results,
    aiReview,
    markdown: generateMarkdownReport(results, options)
  };
  
  // Save report to file
  const reportPath = path.join(workspaceRoot, "test-reports", `test-report-${Date.now()}.json`);
  try {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    report.reportPath = path.relative(workspaceRoot, reportPath);
  } catch (error) {
    // Failed to save report
  }
  
  return report;
}

/**
 * Generate markdown test report
 */
function generateMarkdownReport(results, options) {
  const { framework, duration, testFiles, aiReview = "" } = options;
  const successRate = results.total > 0 ? ((results.passed / results.total) * 100).toFixed(2) : 0;
  
  let markdown = `# Test Report\n\n`;
  markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
  markdown += `**Framework:** ${framework}\n\n`;
  markdown += `**Duration:** ${(duration / 1000).toFixed(2)}s\n\n`;
  
  markdown += `## Summary\n\n`;
  markdown += `| Metric | Value |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Total Tests | ${results.total} |\n`;
  markdown += `| Passed | ${results.passed} |\n`;
  markdown += `| Failed | ${results.failed} |\n`;
  markdown += `| Skipped | ${results.skipped} |\n`;
  markdown += `| Success Rate | ${successRate}% |\n\n`;
  
  if (results.failed > 0 && results.errors.length > 0) {
    markdown += `## Failed Tests\n\n`;
    results.errors.forEach((error, index) => {
      markdown += `### Failure ${index + 1}\n\n`;
      markdown += `\`\`\`\n${error}\n\`\`\`\n\n`;
    });
  }
  
  markdown += `## Test Files\n\n`;
  testFiles.forEach(file => {
    markdown += `- ${file}\n`;
  });

  if (aiReview) {
    markdown += `\n## AI Testing Review\n\n${aiReview}\n`;
  }
  
  return markdown;
}

/**
 * Validate test execution request
 */
function validateTestRequest(options) {
  if (!options || typeof options !== "object") {
    return {
      valid: false,
      error: "Options must be an object"
    };
  }
  
  return { valid: true };
}

module.exports = {
  executeTests,
  validateTestRequest,
  detectTestFramework,
  findTestFiles,
  parseTestResults,
  generateTestReport,
  buildTestCommand
};

// Made with Bob
