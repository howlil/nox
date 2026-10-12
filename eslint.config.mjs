import parser from "@typescript-eslint/parser";

/**
 * Minimal risk-focused baseline. Enable stricter rules separately, only after
 * existing violations are reviewed; do not rewrite working code for style.
 */
export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-unused-labels": "error",
    },
  },
];
