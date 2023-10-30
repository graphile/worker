const NodeEnvironment = require("jest-environment-node");

class CustomEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.AbortController = global.AbortController;
  }
}

module.exports = CustomEnvironment;
