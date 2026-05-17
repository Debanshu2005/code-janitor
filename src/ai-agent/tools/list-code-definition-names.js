/**
 * list-code-definition-names.js
 * 
 * Implements Bob-style list_code_definition_names tool with AST analysis.
 * Extracts code definitions (classes, functions, methods, etc.) from source files.
 */

const fs = require("fs").promises;
const path = require("path");

// Language-specific parsers
const babelParser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DEFINITIONS_PER_FILE = 500;

function extractTypeAnnotationName(typeAnnotation) {
  const annotation = typeAnnotation?.typeAnnotation;
  if (!annotation) {
    return "";
  }

  if (annotation.type === "TSStringKeyword") return "string";
  if (annotation.type === "TSNumberKeyword") return "number";
  if (annotation.type === "TSBooleanKeyword") return "boolean";
  if (annotation.type === "TSArrayType") return "array";
  if (annotation.type === "TSFunctionType") return "function";
  if (annotation.type === "TSTypeReference") {
    return annotation.typeName?.name || "";
  }

  return "";
}

function extractJavaScriptParam(param, index) {
  if (!param) {
    return { name: `param${index}` };
  }

  if (param.type === "Identifier") {
    return {
      name: param.name,
      type: extractTypeAnnotationName(param.typeAnnotation)
    };
  }

  if (param.type === "AssignmentPattern") {
    return extractJavaScriptParam(param.left, index);
  }

  if (param.type === "RestElement") {
    const inner = extractJavaScriptParam(param.argument, index);
    return {
      ...inner,
      name: inner.name ? `...${inner.name}` : `...param${index}`
    };
  }

  if (param.type === "ObjectPattern") {
    return { name: `objectParam${index}` };
  }

  if (param.type === "ArrayPattern") {
    return { name: `arrayParam${index}` };
  }

  return { name: `param${index}` };
}

function extractJavaScriptParams(params = []) {
  return params.map((param, index) => extractJavaScriptParam(param, index));
}

function normalizeParamName(rawName, fallbackName) {
  const cleaned = String(rawName || "")
    .replace(/\/\*.*?\*\//g, "")
    .replace(/=.*/g, "")
    .replace(/\b(?:const|volatile|register|unsigned|signed|static|final)\b/g, "")
    .replace(/[*&]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .pop();

  return cleaned || fallbackName;
}

function parseParamList(paramSource = "") {
  const source = String(paramSource || "").trim();
  if (!source || source === "void") {
    return [];
  }

  return source
    .split(",")
    .map((param, index) => {
      const trimmed = param.trim();
      if (!trimmed) {
        return null;
      }
      return {
        name: normalizeParamName(trimmed, `param${index}`)
      };
    })
    .filter(Boolean);
}

/**
 * Supported file extensions and their language mappings
 */
const LANGUAGE_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".ino": "cpp",
  ".pde": "cpp",
  ".html": "html"
};

/**
 * Parse JavaScript/TypeScript using Babel
 */
function parseJavaScript(content, filePath) {
  const definitions = [];
  const isTypeScript = filePath.endsWith(".ts") || filePath.endsWith(".tsx");
  const classDefinitions = new Map();
  
  try {
    const ast = babelParser.parse(content, {
      sourceType: "module",
      plugins: [
        "jsx",
        "typescript",
        "classProperties",
        "decorators-legacy",
        "dynamicImport",
        "exportDefaultFrom",
        "exportNamespaceFrom",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator"
      ]
    });
    
    traverse(ast, {
      // Class declarations
      ClassDeclaration(path) {
        const node = path.node;
        if (node.id) {
          const classDefinition = {
            type: "class",
            name: node.id.name,
            line: node.loc?.start.line || 0,
            kind: "declaration",
            methods: []
          };
          definitions.push(classDefinition);
          classDefinitions.set(node.id.name, classDefinition);
        }
      },
      
      // Function declarations
      FunctionDeclaration(path) {
        const node = path.node;
        if (node.id) {
          definitions.push({
            type: "function",
            name: node.id.name,
            line: node.loc?.start.line || 0,
            kind: node.async ? "async function" : "function",
            params: extractJavaScriptParams(node.params)
          });
        }
      },
      
      // Arrow functions and function expressions assigned to variables
      VariableDeclarator(path) {
        const node = path.node;
        if (node.id && node.id.type === "Identifier") {
          if (node.init && (node.init.type === "ArrowFunctionExpression" || node.init.type === "FunctionExpression")) {
            definitions.push({
              type: "function",
              name: node.id.name,
              line: node.loc?.start.line || 0,
              kind: node.init.type === "ArrowFunctionExpression" ? "arrow function" : "function expression",
              params: extractJavaScriptParams(node.init.params)
            });
          }
        }
      },
      
      // Class methods
      ClassMethod(path) {
        const node = path.node;
        if (node.key && node.key.type === "Identifier") {
          const className = path.findParent(p => p.isClassDeclaration())?.node?.id?.name || "anonymous";
          const methodDefinition = {
            name: node.key.name,
            params: extractJavaScriptParams(node.params)
          };
          const classDefinition = classDefinitions.get(className);
          if (classDefinition) {
            classDefinition.methods.push(methodDefinition);
          }
          definitions.push({
            type: "method",
            name: `${className}.${node.key.name}`,
            line: node.loc?.start.line || 0,
            kind: node.kind === "constructor" ? "constructor" : node.static ? "static method" : "method",
            params: methodDefinition.params
          });
        }
      },
      
      // Object methods
      ObjectMethod(path) {
        const node = path.node;
        if (node.key && node.key.type === "Identifier") {
          definitions.push({
            type: "method",
            name: node.key.name,
            line: node.loc?.start.line || 0,
            kind: "object method",
            params: extractJavaScriptParams(node.params)
          });
        }
      },
      
      // TypeScript interfaces
      TSInterfaceDeclaration(path) {
        const node = path.node;
        if (node.id) {
          definitions.push({
            type: "interface",
            name: node.id.name,
            line: node.loc?.start.line || 0,
            kind: "interface"
          });
        }
      },
      
      // TypeScript type aliases
      TSTypeAliasDeclaration(path) {
        const node = path.node;
        if (node.id) {
          definitions.push({
            type: "type",
            name: node.id.name,
            line: node.loc?.start.line || 0,
            kind: "type alias"
          });
        }
      },
      
      // TypeScript enums
      TSEnumDeclaration(path) {
        const node = path.node;
        if (node.id) {
          definitions.push({
            type: "enum",
            name: node.id.name,
            line: node.loc?.start.line || 0,
            kind: "enum"
          });
        }
      }
    });
    
    return definitions;
  } catch (error) {
    throw new Error(`Failed to parse JavaScript/TypeScript: ${error.message}`);
  }
}

/**
 * Parse Python using regex patterns (simple approach)
 */
function parsePython(content) {
  const definitions = [];
  const lines = content.split("\n");
  
  // Regex patterns for Python
  const classPattern = /^class\s+(\w+)/;
  const functionPattern = /^def\s+(\w+)\s*\(([^)]*)\)/;
  const methodPattern = /^\s+def\s+(\w+)\s*\(([^)]*)\)/;
  
  let currentClass = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // Check for class
    const classMatch = line.match(classPattern);
    if (classMatch) {
      currentClass = classMatch[1];
      definitions.push({
        type: "class",
        name: currentClass,
        line: lineNum,
        kind: "class",
        methods: []
      });
      continue;
    }
    
    // Check for method (indented def)
    const methodMatch = line.match(methodPattern);
    if (methodMatch && currentClass) {
      const params = parseParamList(methodMatch[2]).filter(
        (param) => param.name !== "self" && param.name !== "cls"
      );
      definitions.push({
        type: "method",
        name: `${currentClass}.${methodMatch[1]}`,
        line: lineNum,
        kind: "method",
        params
      });
      const classDef = definitions.find(
        (definition) => definition.type === "class" && definition.name === currentClass
      );
      if (classDef?.methods) {
        classDef.methods.push({
          name: methodMatch[1],
          params
        });
      }
      continue;
    }
    
    // Check for function (top-level def)
    const functionMatch = line.match(functionPattern);
    if (functionMatch) {
      const params = parseParamList(functionMatch[2]).filter(
        (param) => param.name !== "self" && param.name !== "cls"
      );
      definitions.push({
        type: "function",
        name: functionMatch[1],
        line: lineNum,
        kind: "function",
        params
      });
      currentClass = null; // Reset class context
    }
    
    // Reset class context on unindented non-def line
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t") && !classMatch && !functionMatch) {
      currentClass = null;
    }
  }
  
  return definitions;
}

/**
 * Parse Java using regex patterns
 */
function parseJava(content) {
  const definitions = [];
  const lines = content.split("\n");
  
  // Regex patterns for Java
  const classPattern = /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*class\s+(\w+)/;
  const interfacePattern = /(?:public|private|protected)?\s*interface\s+(\w+)/;
  const methodPattern = /(?:public|private|protected)?\s*(?:static)?\s*(?:final)?\s*(?:[\w<>\[\],?]+\s+)+(\w+)\s*\(([^)]*)\)/;
  
  let currentClass = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;
    
    // Check for class
    const classMatch = line.match(classPattern);
    if (classMatch) {
      currentClass = classMatch[1];
      definitions.push({
        type: "class",
        name: currentClass,
        line: lineNum,
        kind: "class",
        methods: []
      });
      continue;
    }
    
    // Check for interface
    const interfaceMatch = line.match(interfacePattern);
    if (interfaceMatch) {
      currentClass = interfaceMatch[1];
      definitions.push({
        type: "interface",
        name: currentClass,
        line: lineNum,
        kind: "interface",
        methods: []
      });
      continue;
    }
    
    // Check for method
    const methodMatch = line.match(methodPattern);
    if (methodMatch && currentClass) {
      const params = parseParamList(methodMatch[2]);
      definitions.push({
        type: "method",
        name: `${currentClass}.${methodMatch[1]}`,
        line: lineNum,
        kind: "method",
        params
      });
      const classDef = definitions.find(
        (definition) =>
          (definition.type === "class" || definition.type === "interface") &&
          definition.name === currentClass
      );
      if (classDef?.methods) {
        classDef.methods.push({
          name: methodMatch[1],
          params
        });
      }
    }
  }
  
  return definitions;
}

/**
 * Parse C/C++ using regex patterns
 */
function parseCpp(content) {
  const definitions = [];
  const lines = content.split("\n");
  
  // Regex patterns for C/C++
  const classPattern = /(?:class|struct)\s+(\w+)/;
  const functionPattern = /^(?:[\w:\<\>\~]+(?:\s+|[*&])+)+(\w+)\s*\(([^)]*)\)\s*(?:\{|;)/;
  const methodPattern = /^\s*(?:[\w:\<\>\~]+(?:\s+|[*&])+)+(\w+)\s*\(([^)]*)\)\s*(?:\{|;)/;
  
  let currentClass = null;
  let braceDepth = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;
    
    // Track brace depth
    braceDepth += (line.match(/\{/g) || []).length;
    braceDepth -= (line.match(/\}/g) || []).length;
    
    // Check for class/struct
    const classMatch = line.match(classPattern);
    if (classMatch) {
      currentClass = classMatch[1];
      definitions.push({
        type: "class",
        name: currentClass,
        line: lineNum,
        kind: line.startsWith("struct") ? "struct" : "class",
        methods: []
      });
      continue;
    }
    
    // Check for method (inside class)
    if (currentClass && braceDepth > 0) {
      const methodMatch = line.match(methodPattern);
      if (methodMatch) {
        const params = parseParamList(methodMatch[2]);
        definitions.push({
          type: "method",
          name: `${currentClass}.${methodMatch[1]}`,
          line: lineNum,
          kind: "method",
          params
        });
        const classDef = definitions.find(
          (definition) => definition.type === "class" && definition.name === currentClass
        );
        if (classDef?.methods) {
          classDef.methods.push({
            name: methodMatch[1],
            params
          });
        }
        continue;
      }
    }
    
    // Check for function (top-level)
    if (braceDepth === 0) {
      const functionMatch = line.match(functionPattern);
      if (functionMatch && !line.includes("class") && !line.includes("struct")) {
        const params = parseParamList(functionMatch[2]);
        definitions.push({
          type: "function",
          name: functionMatch[1],
          line: lineNum,
          kind: "function",
          params
        });
      }
    }
    
    // Reset class context when exiting class scope
    if (braceDepth === 0) {
      currentClass = null;
    }
  }
  
  return definitions;
}

function parseHtml(content, filePath) {
  return [
    {
      type: "document",
      name: path.basename(filePath),
      line: 1,
      kind: "html document",
      params: [],
      methods: []
    }
  ];
}

/**
 * Get language from file path
 */
function getLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] || null;
}

/**
 * Parse file and extract definitions
 */
async function parseFile(filePath, workspaceRoot) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);
  
  try {
    // Check file size
    const stats = await fs.stat(absolutePath);
    if (stats.size > MAX_FILE_SIZE) {
      return {
        path: filePath,
        error: `File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
      };
    }
    
    // Read file
    const rawContent = await fs.readFile(absolutePath, "utf8");
    const content = Buffer.isBuffer(rawContent)
      ? rawContent.toString("utf8")
      : String(rawContent);
    
    // Determine language
    const language = getLanguage(filePath);
    if (!language) {
      return {
        path: filePath,
        error: `Unsupported file type. Supported: ${Object.keys(LANGUAGE_MAP).join(", ")}`
      };
    }
    
    // Parse based on language
    let definitions = [];
    
    if (language === "javascript" || language === "typescript") {
      definitions = parseJavaScript(content, filePath);
    } else if (language === "python") {
      definitions = parsePython(content);
    } else if (language === "java") {
      definitions = parseJava(content);
    } else if (language === "c" || language === "cpp") {
      definitions = parseCpp(content);
    } else if (language === "html") {
      definitions = parseHtml(content, filePath);
    }
    
    // Limit definitions
    if (definitions.length > MAX_DEFINITIONS_PER_FILE) {
      definitions = definitions.slice(0, MAX_DEFINITIONS_PER_FILE);
    }
    
    // Sort by line number
    definitions.sort((a, b) => a.line - b.line);
    
    return {
      path: filePath,
      language: language,
      definitionCount: definitions.length,
      definitions: definitions
    };
  } catch (error) {
    return {
      path: filePath,
      error: error.message
    };
  }
}

/**
 * List all files in a directory (top-level only)
 */
async function listDirectoryFiles(dirPath, workspaceRoot) {
  const absolutePath = path.isAbsolute(dirPath)
    ? dirPath
    : path.join(workspaceRoot, dirPath);
  
  try {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const files = [];
    
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(dirPath, entry.name);
        const language = getLanguage(entry.name);
        if (language) {
          files.push(filePath);
        }
      }
    }
    
    return files;
  } catch (error) {
    throw new Error(`Failed to read directory: ${error.message}`);
  }
}

/**
 * Main handler for list_code_definition_names tool
 */
async function listCodeDefinitionNames(targetPath, workspaceRoot, executionContext = {}) {
  if (!targetPath) {
    throw new Error("path parameter is required");
  }
  
  const absolutePath = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(workspaceRoot, targetPath);
  
  try {
    const stats = await fs.stat(absolutePath);
    
    if (stats.isFile()) {
      // Single file analysis
      const result = await parseFile(targetPath, workspaceRoot);
      return formatSingleFileResult(result);
    } else if (stats.isDirectory()) {
      // Directory analysis (top-level files only)
      const files = await listDirectoryFiles(targetPath, workspaceRoot);
      
      if (files.length === 0) {
        return `No supported source files found in directory: ${targetPath}\n\nSupported extensions: ${Object.keys(LANGUAGE_MAP).join(", ")}`;
      }
      
      const results = await Promise.all(
        files.map(file => parseFile(file, workspaceRoot))
      );
      
      return formatDirectoryResults(targetPath, results);
    } else {
      throw new Error(`Path is neither a file nor a directory: ${targetPath}`);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Path not found: ${targetPath}`);
    }
    throw error;
  }
}

/**
 * Format single file result
 */
function formatSingleFileResult(result) {
  const lines = [];
  
  lines.push(`# ${result.path}`);
  lines.push("");
  
  if (result.error) {
    lines.push(`Error: ${result.error}`);
    return lines.join("\n");
  }
  
  lines.push(`Language: ${result.language}`);
  lines.push(`Definitions found: ${result.definitionCount}`);
  lines.push("");
  
  if (result.definitions.length === 0) {
    lines.push("No definitions found in this file.");
  } else {
    lines.push("## Definitions");
    lines.push("");
    
    for (const def of result.definitions) {
      lines.push(`- **${def.name}** (${def.kind}) - Line ${def.line}`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Format directory results
 */
function formatDirectoryResults(dirPath, results) {
  const lines = [];
  
  lines.push(`# Code Definitions in ${dirPath}`);
  lines.push("");
  
  const successful = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);
  
  lines.push(`Files analyzed: ${successful.length}/${results.length}`);
  if (failed.length > 0) {
    lines.push(`Failed: ${failed.length}`);
  }
  
  const totalDefinitions = successful.reduce((sum, r) => sum + r.definitionCount, 0);
  lines.push(`Total definitions: ${totalDefinitions}`);
  lines.push("");
  
  // Group by file
  for (const result of results) {
    lines.push(`## ${path.basename(result.path)}`);
    
    if (result.error) {
      lines.push(`Error: ${result.error}`);
    } else {
      lines.push(`Language: ${result.language} | Definitions: ${result.definitionCount}`);
      
      if (result.definitions.length > 0) {
        lines.push("");
        for (const def of result.definitions) {
          lines.push(`- **${def.name}** (${def.kind}) - Line ${def.line}`);
        }
      }
    }
    
    lines.push("");
  }
  
  return lines.join("\n");
}

module.exports = {
  listCodeDefinitionNames,
  parseFile,
  getLanguage,
  LANGUAGE_MAP,
  MAX_FILE_SIZE,
  MAX_DEFINITIONS_PER_FILE
};

// Made with Bob
