const oldVar = 1  // Should become let
const shouldBeConst = 2  // Should become const (no reassignment)
let shouldStayLet = 3  // Should stay let (will be reassigned)
shouldStayLet = 4;      // Reassignment

console.log("hello");  // Should get semicolon
const anotherVar = "test"  // Should become let

function test() {
    return "world";  // Should get semicolon NOW!
}