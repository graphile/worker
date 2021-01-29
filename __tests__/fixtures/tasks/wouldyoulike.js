const { rand } = require("../blah");
module.exports = (_payload, helpers) => {
  helpers.logger.debug(rand());
  return "some sausages";
};
