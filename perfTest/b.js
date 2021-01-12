const a = require("./n").a;
console.log(`perfTest/b.js cyclic check: a is ${a} (expect 3)`);
exports.b = a + 2; /* 5 */
