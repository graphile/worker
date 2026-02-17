const { TestEnvironment } = require("jest-environment-node");

class CustomEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.AbortController = global.AbortController;
  }
}

module.exports = CustomEnvironment;
