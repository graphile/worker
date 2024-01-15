"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const blah_1 = require("../blah");
exports.default = (_payload, helpers) => {
  helpers.logger.debug((0, blah_1.rand)());
  return "some TS sausages";
};
