const { fixPythonBuffer, fixJSBuffer, fixEmbeddedCBuffer, fixJavaBuffer } = require('./src/core/fixers/fixer-wrapper');

async function runTests() {
  const tests = [
    // ================= Python Tests =================
    {
      name: 'Python Syntax & Indentation Test',
      code: `
def greet(name)
print("Hello", name)
if True
print("Condition met")
else
print("Condition not met")
`,
      fixer: fixPythonBuffer
    },
    {
      name: 'Python Function & Loop Test',
      code: `
def compute_sum(nums)
total = 0
for n in nums
total += n
return total
`,
      fixer: fixPythonBuffer
    },

    // ================= JavaScript Tests =================
    {
      name: 'JS Missing Semicolons Test',
      code: `
let a = 5
let b = 10
console.log(a + b)
if(a > b){
console.log("A is bigger")
}else{
console.log("B is bigger")
}
`,
      fixer: fixJSBuffer
    },
    {
      name: 'JS Nested Blocks Test',
      code: `
function checkValues(x, y) {
if(x > y) {
console.log("X is greater")
if(x - y > 10) {
console.log("Difference > 10")
}
}else {
console.log("Y is greater or equal")
}
}
`,
      fixer: fixJSBuffer
    },
    {
      name: 'JS Single-line Block Test',
      code: `
if(true) console.log("Single line if"); else console.log("Single line else");
`,
      fixer: fixJSBuffer
    },

    // ================= Embedded C Tests =================
    {
      name: 'Embedded C Missing Semicolons & Braces',
      code: `
#include <stdio.h>
int main() {
printf("Start")
if(1) {
printf("Inside if")
}else{
printf("Inside else")
}
return 0
`,
      fixer: fixEmbeddedCBuffer
    },
    {
      name: 'Embedded C Loop & Function',
      code: `
void printNumbers(int n) {
for(int i=0;i<n;i++)
printf("%d\\n", i)
}
`,
      fixer: fixEmbeddedCBuffer
    },

    // ================= Java Tests =================
    {
      name: 'Java Missing Semicolons & Braces',
      code: `
import java.util.ArrayList
public class Test {
public static void main(String[] args) {
System.out.println("Start")
if(true) {
System.out.println("Inside if")
}else{
System.out.println("Inside else")
}
}
`,
      fixer: fixJavaBuffer
    },
    {
      name: 'Java Nested If & Extra Braces',
      code: `
public class NestedTest {
public static void main(String[] args) {{
System.out.println("Start")
if(true) {
System.out.println("Condition met")
}}}
`,
      fixer: fixJavaBuffer
    },
    {
      name: 'Java Package & Import Test',
      code: `
package com.example.test
import java.util.List
public class Example {
public void print() {
System.out.println("Hello World")
}
}
`,
      fixer: fixJavaBuffer
    },
    {
      name: 'Java Single-line If',
      code: `
public class SingleLine {
public static void main(String[] args) {
if(true) System.out.println("Single line if")
else System.out.println("Single line else")
}
`,
      fixer: fixJavaBuffer
    }
  ];

  for (const test of tests) {
    console.log(`\n🧪 ${test.name}:`);
    console.log('Original:\n', test.code);

    try {
      const cleanedCode = test.code.split('\n')
        .filter(line => line.trim() && !line.trim().startsWith('Fixed:') && !line.trim().startsWith('---'))
        .join('\n');

      const fixedCode = await test.fixer(cleanedCode);
      console.log('Fixed Code:');
      console.log( fixedCode);
    } catch (err) {
      console.error(`❌ Error running ${test.name}:`, err.message);
    }
  }

  console.log('\n✅ All tests completed!');
}

runTests();
