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
  }
);
