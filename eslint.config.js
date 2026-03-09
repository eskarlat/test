import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"],
  },
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    rules: {
      // TypeScript
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // Cyclomatic complexity — max 10 branches per function
      "complexity": ["warn", { max: 10 }],

      // Cognitive complexity — max 15 (sonarjs)
      "sonarjs/cognitive-complexity": ["warn", 15],
    },
  }
);
