/**
 * R-014 (egress de Supabase): the stored rows of each tournament (its standings, or its rounds), kept between data
 * versions. A new version (after a Limitless sync, an era or alias change) used to read the whole era again (~7 MB of
 * lists in C1 by 19/11/2026, growing until the next era, plus the rounds), even with nobody using the app, because the
 * hourly alerts ask for it. Now it reads only the tournaments that are new to the scope or whose stamp moved.
 *
 * The stamp is what changes whenever a tournament's rows can change: the sync rewrites its standings only together with
 * `fetched_at` (and `standings_sha256`), and its rounds only together with `pairings_fetched_at`, in one transaction
 * each. A tournament without a stamp is never kept. Anything that could rewrite rows without moving their stamp (a
 * backup restore, to be safe) changes `generation`, and then everything is read again.
 *
 * Memory (R-008): only the tournaments of the last `maxScopes` scopes stay, each tournament once however many scopes
 * hold it.
 */
export interface StampedTournament {
  id: string
  /** Changes whenever the tournament's rows can change; null: never kept (read every time). */
  stamp: string | null
}

export class TournamentRowsCache<Row> {
  private readonly byTournament = new Map<string, { stamp: string; rows: readonly Row[] }>()
  private scopes: { key: string; ids: ReadonlySet<string> }[] = []
  private filledAt: number

  constructor(
    private readonly maxScopes: number,
    private readonly generation: () => number,
  ) {
    this.filledAt = generation()
  }

  /**
   * The rows of `tournaments` (the scope's list, read just before), in their order. `read` gets only the ids that are not
   * held under the same stamp, and returns their rows by tournament (a tournament it leaves out has none).
   */
  async rowsOf(
    scope: string,
    tournaments: readonly StampedTournament[],
    read: (ids: string[]) => Promise<ReadonlyMap<string, readonly Row[]>>,
  ): Promise<{ rows: Row[]; read: number }> {
    const generation = this.generation()
    if (generation !== this.filledAt) this.reset(generation)
    // Taken now, before awaiting: another call may prune the map meanwhile.
    const held = new Map<string, readonly Row[]>()
    const missing: StampedTournament[] = []
    for (const tournament of tournaments) {
      const hit = tournament.stamp === null ? undefined : this.byTournament.get(tournament.id)
      if (hit && hit.stamp === tournament.stamp) held.set(tournament.id, hit.rows)
      else missing.push(tournament)
    }
    const fresh = missing.length > 0 ? await read(missing.map((t) => t.id)) : new Map<string, readonly Row[]>()
    // Something rewrote rows while this read (a restore): what came back is returned, not kept.
    if (this.generation() === generation && this.filledAt === generation) {
      for (const tournament of missing) {
        if (tournament.stamp === null) continue
        this.byTournament.set(tournament.id, { stamp: tournament.stamp, rows: fresh.get(tournament.id) ?? [] })
      }
      this.remember(scope, tournaments)
    }
    const rows: Row[] = []
    for (const tournament of tournaments) {
      for (const row of held.get(tournament.id) ?? fresh.get(tournament.id) ?? []) rows.push(row)
    }
    return { rows, read: missing.length }
  }

  /** Tournaments held now. */
  get size(): number {
    return this.byTournament.size
  }

  private reset(generation: number): void {
    this.byTournament.clear()
    this.scopes = []
    this.filledAt = generation
  }

  /** The scope goes first; tournaments that no remembered scope holds any more (left the scope, or its scope was dropped) go. */
  private remember(scope: string, tournaments: readonly StampedTournament[]): void {
    const ids = new Set(tournaments.map((t) => t.id))
    this.scopes = [{ key: scope, ids }, ...this.scopes.filter((item) => item.key !== scope)].slice(0, this.maxScopes)
    for (const id of this.byTournament.keys()) {
      if (!this.scopes.some((item) => item.ids.has(id))) this.byTournament.delete(id)
    }
  }
}
