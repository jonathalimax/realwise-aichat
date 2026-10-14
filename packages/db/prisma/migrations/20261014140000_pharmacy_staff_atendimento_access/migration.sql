-- Pharmacy starter roles: Owner, Manager and Attendant may now edit Atendimento. Clinical handoffs still need a CRF
-- (enforced per handoff by the API); plain availability checks can be handled by any of them. Data-only, additive.
UPDATE "Role" r
SET "permissions" = jsonb_set(r."permissions"::jsonb, '{atendimento}', '"edit"')
FROM "Business" b
WHERE b."id" = r."businessId"
  AND b."niche" = 'farmacia'
  AND r."isStarter" = true
  AND r."key" IN ('owner', 'manager', 'attendant')
  AND COALESCE(r."permissions"->>'atendimento', 'none') <> 'edit';
