let oldVar = 1  // Should become LET (not const)
let shouldBeLet = 2  // Should become LET
const shouldBeConst = 3  // Should become CONST (no reassignment)
let shouldStayLet = 4  // Should stay LET (will be reassigned)
shouldStayLet = 5;      // Reassignment