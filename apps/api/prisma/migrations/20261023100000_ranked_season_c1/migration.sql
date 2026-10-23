-- 22/10/2026: the ranked season C1 (Dual Fusion), 30/11 to 14/12/2026 (ptcgpocket.gg/c1). One row, only when the
-- owner has neither a season «C1» nor one that overlaps those days (the app refuses overlaps, and a season loaded or
-- corrected by hand wins). Nothing else changes.
INSERT INTO "ranked_seasons" ("code", "name", "starts_on", "ends_on")
SELECT 'C1', 'Temporada C1', DATE '2026-11-30', DATE '2026-12-14'
WHERE NOT EXISTS (
    SELECT 1 FROM "ranked_seasons"
    WHERE "code" = 'C1' OR ("starts_on" <= DATE '2026-12-14' AND DATE '2026-11-30' <= "ends_on")
);
