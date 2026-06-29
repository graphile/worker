const { rand } = require("../blah.cjs");
module.exports = (_payload, helpers) => {
  helpers.logger.debug(rand());
  return "some sausages";
};
