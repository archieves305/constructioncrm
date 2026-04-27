"use client";

import { useEffect, useState } from "react";

type Strength = {
  score: number;
  warning: string;
  suggestions: string[];
};

const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
const COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-green-500",
  "bg-emerald-600",
];

export function PasswordStrengthMeter({
  password,
  userInputs = [],
  minScore = 3,
}: {
  password: string;
  userInputs?: string[];
  minScore?: number;
}) {
  const [strength, setStrength] = useState<Strength | null>(null);

  useEffect(() => {
    if (!password) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [{ zxcvbn, zxcvbnOptions }, common, en] = await Promise.all([
        import("@zxcvbn-ts/core"),
        import("@zxcvbn-ts/language-common"),
        import("@zxcvbn-ts/language-en"),
      ]);
      zxcvbnOptions.setOptions({
        translations: en.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...en.dictionary },
      });
      const result = zxcvbn(password, userInputs);
      if (cancelled) return;
      setStrength({
        score: result.score,
        warning: result.feedback.warning ?? "",
        suggestions: result.feedback.suggestions,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [password, userInputs]);

  if (!password) return null;

  const score = strength?.score ?? 0;
  const meets = score >= minScore;

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= score ? COLORS[score] : "bg-gray-200"
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={meets ? "text-green-700" : "text-muted-foreground"}>
          {LABELS[score]}
        </span>
        {!meets && password.length > 0 && (
          <span className="text-amber-700">Need stronger</span>
        )}
      </div>
      {strength?.warning && (
        <p className="text-xs text-amber-700">{strength.warning}</p>
      )}
      {strength?.suggestions && strength.suggestions.length > 0 && !meets && (
        <ul className="ml-4 list-disc text-xs text-muted-foreground">
          {strength.suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
