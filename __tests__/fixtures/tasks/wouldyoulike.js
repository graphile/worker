const { rand } = require("../blah.js");
module.exports = (_payload, helpers) => {
  helpers.logger.debug(rand());
  return "some sausages";
};
