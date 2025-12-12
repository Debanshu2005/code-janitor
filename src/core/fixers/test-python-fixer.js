// Test script for Python fixer
const PythonFixer = require('./python-fixer');
const fs = require('fs');
const path = require('path');

async function testPythonFixer() {
    console.log('Testing Python Fixer...\n');
    
    // Test cases with various syntax errors
    const testCases = [
        {
            name: 'Missing colons and indentation',
            code: `def main()
    if True
        print("Hello")
    else
        print("World")`
        },
        {
            name: 'JavaScript-style syntax',
            code: `var x = true;
function test() {
    if (x === true) {
        console.log("test");
    }
}`
        },
        {
            name: 'Python 2 print statements',
            code: `print "Hello World"
if True:
    print "This is a test"`
        },
        {
            name: 'Mixed indentation issues',
            code: `def test():
print("bad indent")
  if True:
      print("inconsistent")
    else:
  print("very bad")`
        }
    ];
    
    // Test with sample file
    try {
        const samplePath = path.join(__dirname, 'test_sample.py');
        if (fs.existsSync(samplePath)) {
            const sampleCode = fs.readFileSync(samplePath, 'utf8');
            testCases.push({
                name: 'Sample file with errors',
                code: sampleCode
            });
        }
    } catch (error) {
        console.log('Could not read sample file:', error.message);
    }
    
    // Run tests
    for (const testCase of testCases) {
        console.log(`\n=== ${testCase.name} ===`);
        console.log('Original code:');
        console.log(testCase.code);
        console.log('\n---');
        
        try {
            const fixer = new PythonFixer(testCase.code, 'test.py', { verbose: false });
            const result = await fixer.analyze();
            
            console.log('Fixed code:');
            console.log(result.fixedCode);
            console.log(`\nResult: ${result.success ? 'SUCCESS' : 'FAILED'}`);
            console.log(`Fixes applied: ${result.appliedFixes}`);
            console.log(`Message: ${result.message}`);
            
        } catch (error) {
            console.log('ERROR:', error.message);
        }
        
        console.log('\n' + '='.repeat(50));
    }
}

// Run the test
testPythonFixer().catch(console.error);