# Test Setup Guide

This document explains how to set up and run tests for the Code Janitor project.

## Prerequisites

- Node.js >= 18
- Python 3.x (for Python tests)
- npm or yarn

## Quick Setup

Run the automated setup script:

```bash
npm run test:setup
```

This will check all test dependencies and provide guidance on what needs to be installed.

## Manual Setup

### 1. Install Node.js Dependencies

```bash
cd code-janitor
npm install
```

### 2. Update Browser Compatibility Data (Optional)

If you see warnings about `baseline-browser-mapping` being outdated:

```bash
npm i baseline-browser-mapping@latest -D
```

### 3. Install Python Test Dependencies (Optional)

For Python test support:

```bash
pip install pytest pytest-json-report
```

**Note:** If pytest is not installed, the test runner will automatically fall back to Python's built-in `unittest` framework.

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Run Specific Test File

```bash
npm test -- path/to/test-file.test.js
```

## Test Configuration

The project uses Jest as the primary test runner. Configuration is in [`jest.config.js`](jest.config.js:1).

### Key Configuration Options

- **Test Environment**: Node.js
- **Test Pattern**: `**/__tests__/**/*.test.js` and `**/?(*.)+(spec|test).js`
- **Coverage Directory**: `coverage/`
- **Timeout**: 10 seconds per test
- **Max Workers**: 50% of available CPU cores

## Test Framework Support

### JavaScript/TypeScript Tests

- **Primary**: Jest
- **Alternatives**: Mocha, Vitest (auto-detected)

### Python Tests

- **Primary**: pytest (with automatic fallback to unittest)
- **Fallback**: unittest (built-in, no installation required)

### Java Tests

- **Maven**: `mvn test`
- **Gradle**: `gradle test`

## Troubleshooting

### Issue: `baseline-browser-mapping` warnings

**Solution**: Update the package:
```bash
npm i baseline-browser-mapping@latest -D
```

### Issue: `pytest` not recognized

**Solution**: Either install pytest:
```bash
pip install pytest pytest-json-report
```

Or the test runner will automatically use unittest as a fallback.

### Issue: Tests timing out

**Solution**: Increase the timeout in [`jest.config.js`](jest.config.js:1):
```javascript
testTimeout: 30000  // 30 seconds
```

### Issue: Out of memory errors

**Solution**: Reduce max workers in [`jest.config.js`](jest.config.js:1):
```javascript
maxWorkers: '25%'  // Use 25% of CPU cores
```

## Test Structure

```
code-janitor/
├── src/
│   ├── __tests__/           # Top-level tests
│   ├── ai-agent/
│   │   └── __tests__/       # AI agent tests
│   ├── core/
│   │   └── __tests__/       # Core functionality tests
│   └── ...
├── jest.config.js           # Jest configuration
├── setup-tests.js           # Test setup verification script
└── TEST_SETUP.md           # This file
```

## Writing Tests

### Example Jest Test

```javascript
describe('MyModule', () => {
  test('should do something', () => {
    const result = myFunction();
    expect(result).toBe(expected);
  });
});
```

### Example Python Test (pytest)

```python
def test_my_function():
    result = my_function()
    assert result == expected
```

### Example Python Test (unittest)

```python
import unittest

class TestMyModule(unittest.TestCase):
    def test_my_function(self):
        result = my_function()
        self.assertEqual(result, expected)
```

## CI/CD Integration

Tests can be run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run tests
  run: |
    npm install
    npm test
```

## Additional Resources

- [Jest Documentation](https://jestjs.io/)
- [pytest Documentation](https://docs.pytest.org/)
- [Python unittest Documentation](https://docs.python.org/3/library/unittest.html)