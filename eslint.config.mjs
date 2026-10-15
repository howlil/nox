import parser from "@typescript-eslint/parser";
import typescript from "@typescript-eslint/eslint-plugin";

const HIGH_RISK_FILES = [
  "src/agent/ChatGptAdapter.ts",
  "src/agent/CodexAdapter.ts",
  "src/chat/preview-frame.ts",
];

/**
 * Targeted type-aware proof for changed trust boundaries. Existing source
 * baseline remains unchanged; expand the strict file set after type triage.
 * The official Community Scanner runs independently in CI.
 */
export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": typescript },
    rules: {
      "no-duplicate-imports": "error",
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-unused-labels": "error",
    },
  },
  {
    files: HIGH_RISK_FILES,
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
    },
  },
];
