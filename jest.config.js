/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  roots: ["<rootDir>/src", "<rootDir>/__tests__"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  testRegex: "(/__tests__/.*\\.(test|spec))\\.[tj]sx?$",
  moduleFileExtensions: ["ts", "js", "json"],
  testEnvironment: "node",
  globalSetup: "./__tests__/globalSetup.ts",
  // Sometimes CI's clock can get interrupted (it is shared infra!) so this
  // extends the default timeout just in case.
  testTimeout: 15000,
};
