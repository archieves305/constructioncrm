-- Reweight the roof component so a missing permit (the common case — the property
-- API almost always returns permits as "none") no longer auto-inflates the Knock
-- Score via the year-built fallback.
--
--   roof.unknownAgeBuiltOver20Points: 25 -> 15  (inferred-old roof, no permit)
--   roof.permitNoneBuilt15PlusBonus:   5 ->  0  (no-permit "bonus" removed)
--
-- Only patches the live singleton settings row, and only when those fields still
-- hold the original defaults — so a deliberate admin tuning is left untouched and
-- re-running the migration is a no-op.
UPDATE "canvassing_settings"
SET "scoring_config_json" = jsonb_set(
        jsonb_set(
            "scoring_config_json",
            '{roof,unknownAgeBuiltOver20Points}',
            '15'::jsonb,
            false
        ),
        '{roof,permitNoneBuilt15PlusBonus}',
        '0'::jsonb,
        false
    )
WHERE "id" = 'default'
  AND "scoring_config_json" #>> '{roof,unknownAgeBuiltOver20Points}' = '25'
  AND "scoring_config_json" #>> '{roof,permitNoneBuilt15PlusBonus}' = '5';
