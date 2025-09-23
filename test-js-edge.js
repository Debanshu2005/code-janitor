// Variable declarations with different patterns
let globalVar = 1
const moduleLet = 2
let shouldBecomeLet = 3
const shouldBecomeConst = 4
let reassignedVar = 5
reassignedVar = 6;

// Function with various return types
function testReturns() {
    return "string";
    return 42;
    return { key: "value" };
    return [1, 2, 3];
    return
}

// Different expression types
console.log("no semicolon");
const arr = [1, 2, 3]
arr.push(4);
const obj = { key: "value" }
obj.newKey = "new";

// Control flow statements
if (true) {
    console.log("in if block")
}

for (let i = 0; i < 3; i++) {
    console.log(i)
}

// Export should stay let
export let exportedVar = 7