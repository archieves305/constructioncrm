import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  zxcvbnOptions.setOptions({
    translations: zxcvbnEnPackage.translations,
    graphs: zxcvbnCommonPackage.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommonPackage.dictionary,
      ...zxcvbnEnPackage.dictionary,
    },
  });
  configured = true;
}

const MIN_LENGTH = 12;
const MIN_SCORE = 3;

export type PasswordPolicyResult =
  | { ok: true; score: number }
  | { ok: false; reason: string; score: number; suggestions: string[] };

export function validatePassword(
  password: string,
  userInputs: string[] = [],
): PasswordPolicyResult {
  if (password.length < MIN_LENGTH) {
    return {
      ok: false,
      reason: `Password must be at least ${MIN_LENGTH} characters`,
      score: 0,
      suggestions: [],
    };
  }

  ensureConfigured();
  const result = zxcvbn(password, userInputs);

  if (result.score < MIN_SCORE) {
    return {
      ok: false,
      reason: result.feedback.warning || "Password is too weak",
      score: result.score,
      suggestions: result.feedback.suggestions,
    };
  }

  return { ok: true, score: result.score };
}

export const PASSWORD_POLICY = {
  minLength: MIN_LENGTH,
  minScore: MIN_SCORE,
};
