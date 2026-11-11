-- Rename the default revenue account wording for existing organizations.
-- Only accounts still carrying the original default name are changed.
SELECT set_config('app.bypass_rls', 'on', true);
UPDATE accounts SET name = 'Contributions — Organizations & Grantmakers'
  WHERE code = '4010' AND name = 'Contributions — Organizations & Foundations';
SELECT set_config('app.bypass_rls', 'off', true);
