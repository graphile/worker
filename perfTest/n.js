const a = 3;
exports.a = a;
const b = require("./b").b;
const n = a + b;
exports.n = n;
console.log(`n is ${n}`);
