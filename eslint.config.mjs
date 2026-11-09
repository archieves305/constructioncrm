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
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/lib/ui/**/*.ts"],
    ignores: ["src/app/api/**"],
    rules: {
      // The browser's dialogs block the page and can't say what will happen — useConfirm / usePrompt.
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Use useConfirm() from @/components/shared/confirm-provider." },
        { name: "prompt", message: "Use usePrompt() from @/components/shared/confirm-provider." },
        { name: "alert", message: "Use a toast (sonner) or a Callout." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Use useConfirm() from @/components/shared/confirm-provider." },
        { object: "window", property: "prompt", message: "Use usePrompt() from @/components/shared/confirm-provider." },
        { object: "window", property: "alert", message: "Use a toast (sonner) or a Callout." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/(^|[\\s:])(bg|text|border|ring|divide|fill|stroke|outline)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\\b/]", message: "Use a design token (surface-*, fg-secondary, muted-foreground, border, tone-*, stage-*, brand) instead of a raw Tailwind colour — see docs/project-memory/features/design-system.md." },
        { selector: "TemplateElement[value.raw=/(^|[\\s:])(bg|text|border|ring|divide|fill|stroke|outline)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\\b/]", message: "Use a design token (surface-*, fg-secondary, muted-foreground, border, tone-*, stage-*, brand) instead of a raw Tailwind colour — see docs/project-memory/features/design-system.md." },
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
