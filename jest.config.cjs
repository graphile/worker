module.exports = {
  roots: ["<rootDir>/src", "<rootDir>/__tests__"],
  transform: {
    "^.+\\.m?tsx?$": [
      "ts-jest",
      { useESM: true, tsconfig: "<rootDir>/tsconfig.json" },
    ],
  },
  testRegex: "(/__tests__/.*\\.(test|spec))\\.[tj]sx?$",
  moduleFileExtensions: ["ts", "mts", "mjs", "js", "json"],
  extensionsToTreatAsEsm: [".ts", ".mts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },

  testTimeout: 20000,
};
