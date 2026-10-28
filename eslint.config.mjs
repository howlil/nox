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
    // Cover all production TypeScript, including the physically canonical core.
    files: ["src/**/*.ts", "packages/core/src/**/*.ts",
      "headless/src/**/*.ts", "browser/src/**/*.ts"],
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
    // The core is compiled against its own tsconfig.build.json, not the root
    // tsconfig. Baseline syntax rules run without forcing root project service
    // to resolve core files that are deliberately absent from root include.
    // Keep the targeted type-aware safety rules scoped to HIGH_RISK_FILES.
    files: ["packages/core/src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: false },
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
