/**
 * generate-documentation.js
 * 
 * Tool for generating comprehensive documentation for repositories
 */

const fs = require("fs").promises;
const path = require("path");
const { parseFile, getLanguage } = require("./list-code-definition-names");

/**
 * Documentation templates
 */
const DOC_TEMPLATES = {
  readme: {
    sections: [
      "title",
      "description",
      "features",
      "installation",
      "usage",
      "api",
      "configuration",
      "testing",
      "contributing",
      "license"
    ]
  },
  api: {
    sections: ["overview", "endpoints", "parameters", "responses", "examples"]
  },
  contributing: {
    sections: [
      "getting-started",
      "development-setup",
      "coding-standards",
      "testing",
      "pull-requests"
    ]
  }
};

/**
 * Generate documentation for a repository
 */
async function generateDocumentation(options, workspaceRoot, executionContext = {}) {
  const {
    type = "readme",
    outputPath = null,
    includeApi = true,
    includeExamples = true,
    scanDirectory = "src"
  } = options;
  
  try {
    // Analyze repository structure
    const repoAnalysis = await analyzeRepository(workspaceRoot, scanDirectory);
    
    // Generate documentation based on type
    let documentation;
    if (type === "readme") {
      documentation = await generateReadme(repoAnalysis, workspaceRoot);
    } else if (type === "api") {
      documentation = await generateApiDocs(repoAnalysis, includeExamples);
    } else if (type === "contributing") {
      documentation = await generateContributingGuide(repoAnalysis);
    } else if (type === "full") {
      documentation = await generateFullDocumentation(repoAnalysis, workspaceRoot);
    } else {
      return {
        success: false,
        error: `Unknown documentation type: ${type}`
      };
    }
    
    // Determine output path
    const finalOutputPath = outputPath || getDefaultOutputPath(type, workspaceRoot);
    
    // Write documentation to file
    await fs.mkdir(path.dirname(finalOutputPath), { recursive: true });
    await fs.writeFile(finalOutputPath, documentation.content);
    
    return {
      success: true,
      type,
      outputPath: path.relative(workspaceRoot, finalOutputPath),
      documentation,
      analysis: {
        files: repoAnalysis.files.length,
        functions: repoAnalysis.functions.length,
        classes: repoAnalysis.classes.length,
        languages: Object.keys(repoAnalysis.languageStats)
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
 * Analyze repository structure and code
 */
async function analyzeRepository(workspaceRoot, scanDirectory) {
  const analysis = {
    name: path.basename(workspaceRoot),
    files: [],
    functions: [],
    classes: [],
    modules: [],
    dependencies: {},
    languageStats: {},
    structure: {}
  };
  
  // Read package.json if exists
  try {
    const packageJsonPath = path.join(workspaceRoot, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    analysis.name = packageJson.name || analysis.name;
    analysis.description = packageJson.description;
    analysis.version = packageJson.version;
    analysis.dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };
  } catch (error) {
    // No package.json
  }
  
  // Scan source directory
  const scanPath = path.join(workspaceRoot, scanDirectory);
  await scanDirectoryForCode(scanPath, workspaceRoot, analysis);
  
  return analysis;
}

/**
 * Scan directory for code files
 */
async function scanDirectoryForCode(dir, workspaceRoot, analysis) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip common directories
        if (!["node_modules", ".git", "dist", "build", "out", "__tests__"].includes(entry.name)) {
          await scanDirectoryForCode(fullPath, workspaceRoot, analysis);
        }
      } else if (entry.isFile()) {
        const language = getLanguage(entry.name);
        if (language) {
          const relativePath = path.relative(workspaceRoot, fullPath);
          analysis.files.push(relativePath);
          
          // Update language stats
          analysis.languageStats[language] = (analysis.languageStats[language] || 0) + 1;
          
          // Parse file for definitions
          try {
            const content = await fs.readFile(fullPath, "utf-8");
            const definitions = await parseFile(content, language, entry.name);
            
            definitions.forEach(def => {
              if (def.type === "function") {
                analysis.functions.push({
                  name: def.name,
                  file: relativePath,
                  params: def.params,
                  description: def.description
                });
              } else if (def.type === "class") {
                analysis.classes.push({
                  name: def.name,
                  file: relativePath,
                  methods: def.methods,
                  description: def.description
                });
              }
            });
          } catch (error) {
            // Failed to parse file
          }
        }
      }
    }
  } catch (error) {
    // Directory not accessible
  }
}

/**
 * Generate README.md
 */
async function generateReadme(analysis, workspaceRoot) {
  let content = `# ${analysis.name}\n\n`;
  
  if (analysis.description) {
    content += `${analysis.description}\n\n`;
  }
  
  // Version badge
  if (analysis.version) {
    content += `![Version](https://img.shields.io/badge/version-${analysis.version}-blue.svg)\n\n`;
  }
  
  // Table of Contents
  content += `## Table of Contents\n\n`;
  content += `- [Features](#features)\n`;
  content += `- [Installation](#installation)\n`;
  content += `- [Usage](#usage)\n`;
  content += `- [API Documentation](#api-documentation)\n`;
  content += `- [Testing](#testing)\n`;
  content += `- [Contributing](#contributing)\n`;
  content += `- [License](#license)\n\n`;
  
  // Features
  content += `## Features\n\n`;
  content += `- ${analysis.classes.length} classes\n`;
  content += `- ${analysis.functions.length} functions\n`;
  content += `- ${analysis.files.length} source files\n`;
  content += `- Supports: ${Object.keys(analysis.languageStats).join(", ")}\n\n`;
  
  // Installation
  content += `## Installation\n\n`;
  if (analysis.dependencies && Object.keys(analysis.dependencies).length > 0) {
    content += `\`\`\`bash\nnpm install\n\`\`\`\n\n`;
  } else {
    content += `Clone the repository and install dependencies:\n\n`;
    content += `\`\`\`bash\ngit clone <repository-url>\ncd ${analysis.name}\nnpm install\n\`\`\`\n\n`;
  }
  
  // Usage
  content += `## Usage\n\n`;
  content += `\`\`\`javascript\n// Example usage\nconst { ${analysis.classes[0]?.name || "YourClass"} } = require('./${analysis.files[0] || "index.js"}');\n\n`;
  content += `// Initialize\nconst instance = new ${analysis.classes[0]?.name || "YourClass"}();\n\`\`\`\n\n`;
  
  // API Documentation
  content += `## API Documentation\n\n`;
  
  // Document classes
  if (analysis.classes.length > 0) {
    content += `### Classes\n\n`;
    analysis.classes.slice(0, 5).forEach(cls => {
      content += `#### ${cls.name}\n\n`;
      if (cls.description) {
        content += `${cls.description}\n\n`;
      }
      content += `**File:** \`${cls.file}\`\n\n`;
      
      if (cls.methods && cls.methods.length > 0) {
        content += `**Methods:**\n\n`;
        cls.methods.slice(0, 5).forEach(method => {
          const params = method.params?.map(p => p.name).join(", ") || "";
          content += `- \`${method.name}(${params})\`\n`;
        });
        content += `\n`;
      }
    });
  }
  
  // Document functions
  if (analysis.functions.length > 0) {
    content += `### Functions\n\n`;
    analysis.functions.slice(0, 10).forEach(func => {
      const params = func.params?.map(p => p.name).join(", ") || "";
      content += `#### ${func.name}(${params})\n\n`;
      if (func.description) {
        content += `${func.description}\n\n`;
      }
      content += `**File:** \`${func.file}\`\n\n`;
    });
  }
  
  // Testing
  content += `## Testing\n\n`;
  content += `Run tests with:\n\n`;
  content += `\`\`\`bash\nnpm test\n\`\`\`\n\n`;
  
  // Contributing
  content += `## Contributing\n\n`;
  content += `Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) for details.\n\n`;
  
  // License
  content += `## License\n\n`;
  content += `This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.\n`;
  
  return {
    content,
    sections: ["features", "installation", "usage", "api", "testing", "contributing", "license"]
  };
}

/**
 * Generate API documentation
 */
async function generateApiDocs(analysis, includeExamples) {
  let content = `# API Documentation\n\n`;
  content += `Generated: ${new Date().toISOString()}\n\n`;
  
  // Classes
  if (analysis.classes.length > 0) {
    content += `## Classes\n\n`;
    
    analysis.classes.forEach(cls => {
      content += `### ${cls.name}\n\n`;
      if (cls.description) {
        content += `${cls.description}\n\n`;
      }
      content += `**Location:** \`${cls.file}\`\n\n`;
      
      if (cls.methods && cls.methods.length > 0) {
        content += `#### Methods\n\n`;
        
        cls.methods.forEach(method => {
          content += `##### ${method.name}\n\n`;
          
          // Parameters
          if (method.params && method.params.length > 0) {
            content += `**Parameters:**\n\n`;
            method.params.forEach(param => {
              content += `- \`${param.name}\``;
              if (param.type) {
                content += ` (${param.type})`;
              }
              if (param.description) {
                content += `: ${param.description}`;
              }
              content += `\n`;
            });
            content += `\n`;
          }
          
          // Example
          if (includeExamples) {
            const paramNames = method.params?.map(p => p.name).join(", ") || "";
            content += `**Example:**\n\n`;
            content += `\`\`\`javascript\n`;
            content += `const instance = new ${cls.name}();\n`;
            content += `instance.${method.name}(${paramNames});\n`;
            content += `\`\`\`\n\n`;
          }
        });
      }
    });
  }
  
  // Functions
  if (analysis.functions.length > 0) {
    content += `## Functions\n\n`;
    
    analysis.functions.forEach(func => {
      content += `### ${func.name}\n\n`;
      if (func.description) {
        content += `${func.description}\n\n`;
      }
      content += `**Location:** \`${func.file}\`\n\n`;
      
      // Parameters
      if (func.params && func.params.length > 0) {
        content += `**Parameters:**\n\n`;
        func.params.forEach(param => {
          content += `- \`${param.name}\``;
          if (param.type) {
            content += ` (${param.type})`;
          }
          if (param.description) {
            content += `: ${param.description}`;
          }
          content += `\n`;
        });
        content += `\n`;
      }
      
      // Example
      if (includeExamples) {
        const paramNames = func.params?.map(p => p.name).join(", ") || "";
        content += `**Example:**\n\n`;
        content += `\`\`\`javascript\n`;
        content += `${func.name}(${paramNames});\n`;
        content += `\`\`\`\n\n`;
      }
    });
  }
  
  return {
    content,
    sections: ["classes", "functions"]
  };
}

/**
 * Generate contributing guide
 */
async function generateContributingGuide(analysis) {
  let content = `# Contributing Guide\n\n`;
  content += `Thank you for your interest in contributing to ${analysis.name}!\n\n`;
  
  content += `## Getting Started\n\n`;
  content += `1. Fork the repository\n`;
  content += `2. Clone your fork: \`git clone <your-fork-url>\`\n`;
  content += `3. Create a branch: \`git checkout -b feature/your-feature\`\n`;
  content += `4. Make your changes\n`;
  content += `5. Run tests: \`npm test\`\n`;
  content += `6. Commit your changes: \`git commit -m "Add feature"\`\n`;
  content += `7. Push to your fork: \`git push origin feature/your-feature\`\n`;
  content += `8. Create a Pull Request\n\n`;
  
  content += `## Development Setup\n\n`;
  content += `\`\`\`bash\n`;
  content += `npm install\n`;
  content += `npm run dev\n`;
  content += `\`\`\`\n\n`;
  
  content += `## Coding Standards\n\n`;
  content += `- Follow the existing code style\n`;
  content += `- Write clear, descriptive commit messages\n`;
  content += `- Add tests for new features\n`;
  content += `- Update documentation as needed\n`;
  content += `- Ensure all tests pass before submitting PR\n\n`;
  
  content += `## Testing\n\n`;
  content += `Run the test suite:\n\n`;
  content += `\`\`\`bash\n`;
  content += `npm test\n`;
  content += `\`\`\`\n\n`;
  
  content += `## Pull Request Process\n\n`;
  content += `1. Update the README.md with details of changes if applicable\n`;
  content += `2. Update the version numbers following [SemVer](https://semver.org/)\n`;
  content += `3. The PR will be merged once you have approval from maintainers\n\n`;
  
  content += `## Code of Conduct\n\n`;
  content += `Please be respectful and constructive in all interactions.\n`;
  
  return {
    content,
    sections: ["getting-started", "development-setup", "coding-standards", "testing", "pull-requests"]
  };
}

/**
 * Generate full documentation suite
 */
async function generateFullDocumentation(analysis, workspaceRoot) {
  const readme = await generateReadme(analysis, workspaceRoot);
  const api = await generateApiDocs(analysis, true);
  const contributing = await generateContributingGuide(analysis);
  
  return {
    content: readme.content,
    additional: {
      api: api.content,
      contributing: contributing.content
    },
    sections: [...readme.sections, "api-docs", "contributing-guide"]
  };
}

/**
 * Get default output path for documentation type
 */
function getDefaultOutputPath(type, workspaceRoot) {
  const paths = {
    readme: path.join(workspaceRoot, "README.md"),
    api: path.join(workspaceRoot, "docs", "API.md"),
    contributing: path.join(workspaceRoot, "CONTRIBUTING.md"),
    full: path.join(workspaceRoot, "README.md")
  };
  
  return paths[type] || paths.readme;
}

/**
 * Validate documentation generation request
 */
function validateDocumentationRequest(options) {
  if (!options || typeof options !== "object") {
    return {
      valid: false,
      error: "Options must be an object"
    };
  }
  
  const validTypes = ["readme", "api", "contributing", "full"];
  if (options.type && !validTypes.includes(options.type)) {
    return {
      valid: false,
      error: `Invalid documentation type. Must be one of: ${validTypes.join(", ")}`
    };
  }
  
  return { valid: true };
}

module.exports = {
  generateDocumentation,
  validateDocumentationRequest,
  analyzeRepository,
  generateReadme,
  generateApiDocs,
  generateContributingGuide
};

// Made with Bob
