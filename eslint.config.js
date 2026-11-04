// Lint (hardening plan item 5): the recommended rules plus typescript-eslint's, with no `any` anywhere in src/.
// Type checking itself is `npm run typecheck` (strict, noUncheckedIndexedAccess).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "worker/", "coverage/", "test-results/", "docs/", "**/*.gen.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "examples/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
);
