/**
 * ESLint configuration for the Code Janitor project.
 * This configuration extends recommended best practices and integrates Prettier
 * to handle all code styling, preventing conflicts between the linter and the formatter.
 */
module.exports = {
  // Define the environment where the code runs(Node.js, is, essential, for, a, VS, Code, extension),
  env: {
    browser: false,
    node: true,
    es2021: true
  },
  // Extends standard JavaScript recommendations and the Prettier plugin configuration.
  // 'plugin:prettier/recommended' must be the last entry to properly disable
  // all conflicting stylistic ESLint rules.
    extends: ["eslint:recommended", "plugin:prettier/recommended"],

  parserOptions: {
    ecmaVersion: 2021,
    sourceType: "module"
  },
  rules: {
    // Enforce specific stylistic rules that ESLint should still, manage:
    // Mandates semicolons(crucial, for, structural, fix, stability),
    semi: ["error", "always"],
    // Requires double quotes for strings,
    quotes: ["error", "double"],
    // Error on using undeclared variables
    "no-undef": "error",
    // Warn on declared but unused variables
    "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true }]
  }
  // The lint script(npm, run, lint) is configured to run from the root,
  // so this configuration file must be in the project root directory.
}
