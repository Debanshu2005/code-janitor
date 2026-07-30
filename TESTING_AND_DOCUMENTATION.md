# Testing and Documentation Features

Code Janitor now includes comprehensive edge case testing, test execution, and documentation generation capabilities.

## Table of Contents

- [Edge Case Generation](#edge-case-generation)
- [Test Execution](#test-execution)
- [Documentation Generation](#documentation-generation)
- [Integration](#integration)
- [Examples](#examples)

## Edge Case Generation

Generate comprehensive edge cases for testing your code automatically.

### Features

- **Automatic Edge Case Detection**: Analyzes functions and classes to generate relevant edge cases
- **Multiple Categories**: Numeric, String, Array, Object, Boolean, Function, and Date edge cases
- **Security Testing**: Includes XSS and SQL injection test cases
- **Test Code Generation**: Automatically generates test code in Jest, pytest, or JUnit format
- **Optional AI Augmentation**: A preferred provider such as IBM BOB can contribute extra edge cases and testing notes when `codeJanitor.testing.aiAssist.enabled` is turned on

### Edge Case Categories

#### Numeric Boundaries
- Zero value
- Negative values
- Maximum/minimum safe integers
- Infinity and NaN
- Floating point precision issues

#### String Boundaries
- Empty strings
- Whitespace variations
- Very long strings
- Unicode characters
- Security payloads (XSS, SQL injection)

#### Array Boundaries
- Empty arrays
- Arrays with null/undefined
- Large arrays
- Nested arrays
- Mixed type arrays

#### Object Boundaries
- Empty objects
- Null objects
- Objects without prototypes
- Deeply nested objects

### Usage

```javascript
// Generate edge cases for a file
const result = await generateEdgeCases('src/calculator.js', workspaceRoot);

console.log(`Generated ${result.edgeCaseCount} edge cases`);
console.log(`Test file: ${result.testFilePath}`);
console.log(`Test code:\n${result.testCode}`);
```

### API

#### `generateEdgeCases(filePath, workspaceRoot, executionContext)`

Generates edge cases for a source file.

**Parameters:**
- `filePath` (string): Path to the source file
- `workspaceRoot` (string): Workspace root directory
- `executionContext` (object): Optional execution context

**Returns:**
```javascript
{
  success: boolean,
  filePath: string,
  language: string,
  edgeCaseCount: number,
  edgeCases: Array,
  testCode: string,
  testFilePath: string,
  summary: {
    totalEdgeCases: number,
    byCategory: object,
    definitions: number
  }
}
```

#### `generateFunctionEdgeCases(functionDef)`

Generates edge cases for a specific function.

**Parameters:**
- `functionDef` (object): Function definition with name and params

**Returns:** Array of edge case objects

#### `generateClassEdgeCases(classDef)`

Generates edge cases for a class including constructor and methods.

**Parameters:**
- `classDef` (object): Class definition with name and methods

**Returns:** Array of edge case objects

## Test Execution

Execute tests with comprehensive reporting and edge case coverage.

### Features

- **Framework Detection**: Automatically detects Jest, Mocha, pytest, JUnit
- **Test Discovery**: Finds all test files matching patterns
- **Comprehensive Reports**: Generates detailed test reports with statistics
- **Edge Case Integration**: Includes edge case tests in execution
- **Multiple Formats**: Supports JavaScript, Python, and Java test frameworks
- **AI Testing Review**: Can append a provider-generated review section that highlights likely edge-case gaps and next testing priorities

### Supported Test Frameworks

#### JavaScript/TypeScript
- **Jest**: Full support with coverage
- **Mocha**: Standard test execution
- **Vitest**: Modern test runner support

#### Python
- **pytest**: Full support with JSON reports
- **unittest**: Standard Python testing

#### Java
- **JUnit**: Maven and Gradle support

### Usage

```javascript
// Run all tests
const result = await executeTests({
  generateReport: true,
  includeEdgeCases: true
}, workspaceRoot);

console.log(`Tests: ${result.summary.passed}/${result.summary.total} passed`);
console.log(`Duration: ${result.summary.duration}ms`);
console.log(`Report: ${result.report.reportPath}`);
```

```javascript
// Run specific test file
const result = await executeTests({
  testPath: 'src/__tests__/calculator.test.js',
  framework: 'jest',
  generateReport: true
}, workspaceRoot);
```

### API

#### `executeTests(options, workspaceRoot, executionContext)`

Executes tests and generates reports.

**Parameters:**
- `options` (object):
  - `testPath` (string, optional): Specific test file or directory
  - `framework` (string, optional): Test framework to use
  - `generateReport` (boolean, optional): Generate detailed report (default: true)
  - `includeEdgeCases` (boolean, optional): Include edge case tests (default: true)
- `workspaceRoot` (string): Workspace root directory
- `executionContext` (object): Optional execution context

**Returns:**
```javascript
{
  success: boolean,
  framework: string,
  testFiles: Array<string>,
  results: {
    total: number,
    passed: number,
    failed: number,
    skipped: number,
    tests: Array,
    errors: Array
  },
  report: {
    timestamp: string,
    framework: string,
    duration: number,
    summary: object,
    markdown: string,
    reportPath: string
  },
  duration: number,
  summary: object
}
```

#### `detectTestFramework(workspaceRoot, language)`

Detects the test framework used in the project.

**Parameters:**
- `workspaceRoot` (string): Workspace root directory
- `language` (string): Programming language

**Returns:** Framework object or null

#### `findTestFiles(workspaceRoot, testPattern)`

Finds all test files matching the pattern.

**Parameters:**
- `workspaceRoot` (string): Workspace root directory
- `testPattern` (RegExp): Test file pattern

**Returns:** Array of test file paths

#### `parseTestResults(stdout, stderr, framework)`

Parses test output into structured results.

**Parameters:**
- `stdout` (string): Standard output
- `stderr` (string): Standard error
- `framework` (string): Test framework name

**Returns:** Parsed test results object

#### `generateTestReport(results, options)`

Generates a comprehensive test report.

**Parameters:**
- `results` (object): Test results
- `options` (object): Report options

**Returns:** Report object with markdown content

## Documentation Generation

Generate comprehensive documentation for repositories automatically.

### Features

- **Multiple Documentation Types**: README, API docs, Contributing guides
- **Automatic Analysis**: Scans codebase to extract structure
- **API Documentation**: Documents classes, functions, and parameters
- **Code Examples**: Includes usage examples
- **Markdown Format**: Professional markdown output

### Documentation Types

#### README
- Project overview
- Features list
- Installation instructions
- Usage examples
- API documentation
- Testing guide
- Contributing guide
- License information

#### API Documentation
- Class documentation
- Method signatures
- Parameter descriptions
- Return types
- Code examples

#### Contributing Guide
- Getting started
- Development setup
- Coding standards
- Testing requirements
- Pull request process
- Code of conduct

#### Full Documentation
- Complete README
- Separate API documentation
- Contributing guide
- All in one generation

### Usage

```javascript
// Generate README
const result = await generateDocumentation({
  type: 'readme',
  includeApi: true,
  includeExamples: true
}, workspaceRoot);

console.log(`Documentation generated: ${result.outputPath}`);
```

```javascript
// Generate full documentation suite
const result = await generateDocumentation({
  type: 'full',
  scanDirectory: 'src'
}, workspaceRoot);

console.log(`README: ${result.outputPath}`);
console.log(`API Docs: ${result.documentation.additional.api}`);
console.log(`Contributing: ${result.documentation.additional.contributing}`);
```

### API

#### `generateDocumentation(options, workspaceRoot, executionContext)`

Generates documentation for a repository.

**Parameters:**
- `options` (object):
  - `type` (string): 'readme', 'api', 'contributing', or 'full' (default: 'readme')
  - `outputPath` (string, optional): Custom output path
  - `includeApi` (boolean, optional): Include API docs (default: true)
  - `includeExamples` (boolean, optional): Include examples (default: true)
  - `scanDirectory` (string, optional): Directory to scan (default: 'src')
- `workspaceRoot` (string): Workspace root directory
- `executionContext` (object): Optional execution context

**Returns:**
```javascript
{
  success: boolean,
  type: string,
  outputPath: string,
  documentation: {
    content: string,
    sections: Array<string>,
    additional?: {
      api: string,
      contributing: string
    }
  },
  analysis: {
    files: number,
    functions: number,
    classes: number,
    languages: Array<string>
  }
}
```

#### `analyzeRepository(workspaceRoot, scanDirectory)`

Analyzes repository structure and code.

**Parameters:**
- `workspaceRoot` (string): Workspace root directory
- `scanDirectory` (string): Directory to scan

**Returns:** Repository analysis object

#### `generateReadme(analysis, workspaceRoot)`

Generates README documentation.

**Parameters:**
- `analysis` (object): Repository analysis
- `workspaceRoot` (string): Workspace root directory

**Returns:** README content object

#### `generateApiDocs(analysis, includeExamples)`

Generates API documentation.

**Parameters:**
- `analysis` (object): Repository analysis
- `includeExamples` (boolean): Include code examples

**Returns:** API documentation object

#### `generateContributingGuide(analysis)`

Generates contributing guide.

**Parameters:**
- `analysis` (object): Repository analysis

**Returns:** Contributing guide object

## Integration

All three tools are integrated into the Code Janitor tool registry and can be used through the AI agent.

### Tool Registry

The tools are registered in `tool-registry.js`:

- `generate_edge_cases`: Generate edge cases for testing
- `execute_tests`: Execute tests with reporting
- `generate_documentation`: Generate repository documentation

### Using with AI Agent

The AI agent can automatically use these tools when appropriate:

```javascript
// The agent will automatically:
// 1. Generate edge cases when asked to test code
// 2. Execute tests when asked to run tests
// 3. Generate documentation when asked to document code
```

## Examples

### Complete Testing Workflow

```javascript
// 1. Generate edge cases
const edgeCases = await generateEdgeCases('src/calculator.js', workspaceRoot);
console.log(`Generated ${edgeCases.edgeCaseCount} edge cases`);

// 2. Execute tests including edge cases
const testResults = await executeTests({
  includeEdgeCases: true,
  generateReport: true
}, workspaceRoot);

console.log(`Tests: ${testResults.summary.passed}/${testResults.summary.total} passed`);
console.log(`Success rate: ${testResults.report.summary.successRate}%`);

// 3. Generate documentation
const docs = await generateDocumentation({
  type: 'full',
  includeApi: true,
  includeExamples: true
}, workspaceRoot);

console.log(`Documentation generated at ${docs.outputPath}`);
```

### Edge Case Testing Example

```javascript
// Generate edge cases for a calculator module
const result = await generateEdgeCases('src/math/calculator.js', workspaceRoot);

// Result includes:
// - Numeric edge cases (0, -1, Infinity, NaN)
// - Boundary conditions
// - Generated test code
// - Test file path

// Write the test file
await fs.writeFile(result.testFilePath, result.testCode);

// Run the tests
const testResult = await executeTests({
  testPath: result.testFilePath,
  framework: 'jest'
}, workspaceRoot);
```

### Documentation Generation Example

```javascript
// Generate complete documentation suite
const result = await generateDocumentation({
  type: 'full',
  scanDirectory: 'src',
  includeApi: true,
  includeExamples: true
}, workspaceRoot);

// Outputs:
// - README.md with project overview
// - docs/API.md with API documentation
// - CONTRIBUTING.md with contribution guidelines

console.log(`Files analyzed: ${result.analysis.files}`);
console.log(`Functions documented: ${result.analysis.functions}`);
console.log(`Classes documented: ${result.analysis.classes}`);
```

## Best Practices

### Edge Case Generation

1. **Run on Critical Code**: Focus on business logic and utility functions
2. **Review Generated Cases**: Manually review edge cases for completeness
3. **Add Custom Cases**: Supplement with domain-specific edge cases
4. **Update Regularly**: Regenerate when code changes

### Test Execution

1. **Use CI/CD Integration**: Run tests automatically on commits
2. **Monitor Reports**: Review test reports for trends
3. **Fix Failures Promptly**: Address failing tests immediately
4. **Track Coverage**: Monitor test coverage metrics

### Documentation Generation

1. **Keep Code Documented**: Add JSDoc/docstrings to code
2. **Regenerate Regularly**: Update docs when code changes
3. **Review Generated Docs**: Ensure accuracy and completeness
4. **Customize as Needed**: Edit generated docs for clarity

## Troubleshooting

### Edge Case Generation Issues

**Problem**: No edge cases generated
- **Solution**: Ensure file contains functions or classes
- **Solution**: Check file is a supported language

**Problem**: Test code syntax errors
- **Solution**: Review generated test code
- **Solution**: Adjust edge case values if needed

### Test Execution Issues

**Problem**: Framework not detected
- **Solution**: Ensure package.json includes test framework
- **Solution**: Add framework config file

**Problem**: Tests fail to run
- **Solution**: Check test command is correct
- **Solution**: Verify test files exist

### Documentation Generation Issues

**Problem**: Empty documentation
- **Solution**: Ensure source files exist in scan directory
- **Solution**: Check files are supported languages

**Problem**: Missing API details
- **Solution**: Add JSDoc/docstrings to code
- **Solution**: Ensure functions/classes are exported

## Contributing

Contributions to improve testing and documentation features are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.
