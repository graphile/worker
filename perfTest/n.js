const a = 3;
exports.a = a;
const b = require("./b").b;
const n = a + b; /* 3 + 5 */
exports.n = n;
console.log(`perfTest/n.js cyclic check: n is ${n} (expect 8)`);
