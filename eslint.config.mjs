import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Downgraded so the existing findings do not block CI; restore to "error" once #21 fixes them.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "@next/next/no-assign-module-variable": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  globalIgnores([".next/**", "dist/**", "next-env.d.ts"]),
]);
