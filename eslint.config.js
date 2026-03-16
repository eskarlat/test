import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/coverage/**"],
  },
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    rules: {
      // TypeScript
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",

      // Cyclomatic complexity — max 10 branches per function
      "complexity": ["warn", { max: 10 }],

      // Disable sonarjs no-unused-vars in favor of @typescript-eslint/no-unused-vars
      "sonarjs/no-unused-vars": "off",

      // Cognitive complexity — max 15 (sonarjs)
      "sonarjs/cognitive-complexity": ["warn", 15],
    },
  },
  // Relaxed rules for test files
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      // Test files frequently use `any` for mocks and type assertions
      "@typescript-eslint/no-explicit-any": "warn",
      // Test files use tmpdir() for temp directories — not a security concern
      "sonarjs/publicly-writable-directories": "off",
      // Test files may use Math.random() for unique identifiers
      "sonarjs/pseudo-random": "off",
    },
  }
);
