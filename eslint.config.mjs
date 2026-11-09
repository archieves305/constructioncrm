import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // `fetch(url).then((r) => r.json())` hands a refusal or a server error's
    // body back as data (stuck skeletons, ".map is not a function"). Client
    // code reads through fetchJson, which throws an HttpError with the status.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    ignores: ["src/app/api/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='then'][callee.object.type='CallExpression'][callee.object.callee.name='fetch'][arguments.0.body.callee.property.name='json']",
          message: "Use fetchJson from @/lib/fetch-json: it throws on a non-2xx answer instead of returning the error body as data.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Sibling worktrees checked out under the repo (`.claude/worktrees/*`)
    // are whole copies of the tree; linting them doubles every count.
    ".claude/**",
    // The phone app (Expo) has its own package, lint and typecheck.
    "mobile/**",
  ]),
]);

export default eslintConfig;
