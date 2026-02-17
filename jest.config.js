module.exports = {
  roots: ["<rootDir>/src", "<rootDir>/__tests__"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  testRegex: "(/__tests__/.*\\.(test|spec))\\.[tj]sx?$",
  moduleFileExtensions: ["ts", "mjs", "js", "json"],
  extensionsToTreatAsEsm: [".ts", ".mjs"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testEnvironment: "./__tests__/nodeEnvironment.js",
};
