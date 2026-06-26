const js = require("@eslint/js");
const { FlatCompat } = require("@eslint/eslintrc");
const { readFileSync } = require("node:fs");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

const ignores = readFileSync(`${__dirname}/.lintignore`, "utf8")
  .split(/\n/)
  .map((line) => {
    let l = line.trim();
    if (l == "") return null;
    if (l.startsWith("/")) {
      l = l.substring(1);
    }
    if (!l.match(/\.[a-z]+$/)) {
      l += "/**";
    }
    return l;
  })
  .filter((l) => l != null);

module.exports = [
  {
    ignores: [...ignores, "eslint.config.js", ".prettierrc.js"],
  },
  ...compat
    .config({
      parser: "@typescript-eslint/parser",
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:import/errors",
        "plugin:import/typescript",
        "prettier",
      ],
      plugins: ["jest", "@typescript-eslint", "simple-import-sort", "import"],
      parserOptions: {
        ecmaVersion: 2018,
        sourceType: "module",
      },
      env: {
        node: true,
        jest: true,
        es6: true,
      },
      globals: {
        NodeJS: false, // For TypeScript
      },
      rules: {
        "no-unused-vars": 0,
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            args: "after-used",
            caughtErrors: "none",
            ignoreRestSiblings: true,
          },
        ],
        curly: "error",
        "no-else-return": 0,
        "no-return-assign": [2, "except-parens"],
        "no-underscore-dangle": 0,
        "jest/no-focused-tests": 2,
        "jest/no-identical-title": 2,
        camelcase: 0,
        "prefer-arrow-callback": [
          "error",
          {
            allowNamedFunctions: true,
          },
        ],
        "class-methods-use-this": 0,
        "no-restricted-syntax": 0,
        "no-param-reassign": [
          "error",
          {
            props: false,
          },
        ],

        "arrow-body-style": 0,
        "no-nested-ternary": 0,

        /*
         * simple-import-sort seems to be the most stable import sorting currently,
         * disable others
         */
        "simple-import-sort/imports": "error",
        "simple-import-sort/exports": "error",
        "sort-imports": "off",
        "import/order": "off",

        // Forbid: `import x from "./foo"`; require `"./foo.ts"`
        "import/extensions": [
          "error",
          "ignorePackages",
          { checkTypeImports: true },
        ],
        "import/no-deprecated": "warn",
        "import/no-duplicates": "error",
        // Doesn't support 'exports'?
        "import/no-unresolved": "off",
        "@typescript-eslint/ban-ts-comment": "off",
        "@typescript-eslint/no-namespace": "off",

        // ESLint 10 additions
        "@typescript-eslint/no-var-requires": "error",
        "import/namespace": "off",
        "@typescript-eslint/no-empty-object-type": "off",
        "@typescript-eslint/no-require-imports": "off",
      },
      overrides: [
        {
          files: ["__tests__/**/*", "test.js"],
          rules: {
            "@typescript-eslint/no-explicit-any": 0,
            "@typescript-eslint/explicit-function-return-type": 0,
            "@typescript-eslint/no-var-requires": 0,
            "@typescript-eslint/ban-ts-comment": 0,

            // ESLint 9 additions
            "@typescript-eslint/no-unused-expressions": 0,
          },
        },
        {
          files: ["perfTest/**/*", "examples/**/*"],
          rules: {
            "@typescript-eslint/no-var-requires": 0,
          },
        },
      ],
    })
    .map((config) => ({
      ...config,
      files: config.files ?? ["**/*.{js,jsx,ts,tsx,graphql}"],
    })),
];
