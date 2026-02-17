module.exports = {
  roots: ["<rootDir>/src", "<rootDir>/__tests__"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: { rootDir: ".", module: "node16" } },
    ],
  },
  testRegex: "(/__tests__/.*\\.(test|spec))\\.[tj]sx?$",
  moduleFileExtensions: ["ts", "js", "json"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testEnvironment: "./__tests__/nodeEnvironment.js",
  testTimeout: 20000,
};
