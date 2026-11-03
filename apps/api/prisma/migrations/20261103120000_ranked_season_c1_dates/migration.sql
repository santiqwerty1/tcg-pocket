-- 3/11/2026 (ranked/c1-dates): the official dates of the ranked season C1 (pokemon.com/es, 28/10/2026: «1 de diciembre
-- de 2026 a las 06:00 UTC - 15 de diciembre de 2026 a las 06:59 UTC»), by whole days of Buenos Aires: 1/12 to 15/12.
-- The migration of 22/10 loaded 30/11 to 14/12 (ptcgpocket.gg). One UPDATE, and only:
--   - of the row «C1» that still has exactly those dates (one the owner corrected stays as it is; none is created);
--   - when no other season touches 1/12–15/12 (the app refuses overlaps);
--   - when no competitive match and no rank note falls on a day that changes season, in Buenos Aires: 30/11 leaves C1
--     and 15/12 joins it (a rank note counts by the instant right after it, as `seasonOfChange`). Matches dated in the
--     future are refused, so none can be there on 3/11; if some were, the owner decides from Ranked.
-- Under the ranks' advisory lock (ADVISORY_LOCKS.rankNote = 43120), which every season edit of the app takes: the
-- release runs while the previous version still serves. `prisma migrate deploy` sends each statement on its own (each
-- one would be its own autocommit transaction, and the lock would end with its SELECT), so the script opens an explicit
-- transaction: the lock lasts until the UPDATE commits (review of #176). Nothing else changes.
BEGIN;

SELECT pg_advisory_xact_lock(43120);

UPDATE "ranked_seasons"
SET "starts_on" = DATE '2026-12-01', "ends_on" = DATE '2026-12-15', "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'C1'
  AND "starts_on" = DATE '2026-11-30'
  AND "ends_on" = DATE '2026-12-14'
  AND NOT EXISTS (
    SELECT 1 FROM "ranked_seasons" AS "other"
    WHERE "other"."code" <> 'C1'
      AND "other"."starts_on" <= DATE '2026-12-15'
      AND DATE '2026-12-01' <= "other"."ends_on"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "matches"
    WHERE "mode" = 'competitive'
      AND ("played_at" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date IN (DATE '2026-11-30', DATE '2026-12-15')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "rank_changes"
    WHERE (("at" + INTERVAL '1 millisecond') AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      IN (DATE '2026-11-30', DATE '2026-12-15')
  );

COMMIT;
