import { describe, expect, it } from 'vitest'
import { validateDeck } from '../../src/decks/index.js'
import type { SelectableEnergy } from '../../src/index.js'
import {
  cardChanges,
  confirmVerdict,
  DEFAULT_EXPLORE_CONFIG,
  EXPLORE_SEED_STRIDE,
  exploreConfig,
  exploreGames,
  exploreSeed,
  formatDifferenceEs,
  formatMetaScoreEs,
  gamesByWeight,
  groupsOfCards,
  type MetaScore,
  metaGauntlet,
  metaScore,
  mutationPool,
  NOVELTY_MAX_SWAPS,
  neighborhoodUsage,
  novelty,
  poolWeight,
  robustnessEs,
  robustnessOf,
  roundGames,
  roundWinner,
  scoreBeats,
  scoreDifference,
  secondListsFor,
  seededRandom,
  usableWith,
  variantOf,
  verifyAccepts,
} from '../../src/lab/index.js'
import { buildSnapshot } from '../../src/simulation/index.js'
import {
  archetypeRows,
  buildDataset,
  cardUsage,
  DEFAULT_SET_RELEASES,
  listKeyByGroup,
  listRows,
  parseStandings,
  rankArchetypeLists,
} from '../../src/tournaments/index.js'
import { BIG_ID, readLimitless } from '../helpers/limitless.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
// PMPT #45 (393 lists, 5/9/2026): a real era's meta.
const dataset = buildDataset({
  tournaments: [
    { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
  ],
  entries: parseStandings(readLimitless('big_standings.json')).map((entry) => ({ ...entry, tournamentId: BIG_ID })),
  index,
  sets: DEFAULT_SET_RELEASES,
  era: 'B4a',
  format: 'STANDARD',
  minPlayers: 12,
})
const rows = listRows(dataset, 'group')

describe('meta bank', () => {
  it('the most played archetypes with their representative list, weighted by share', () => {
    const gauntlet = metaGauntlet(dataset, { size: 10 })
    expect(gauntlet.rivals).toHaveLength(10)
    expect(gauntlet.lists).toBe(393)
    const archetypes = archetypeRows(dataset).filter((row) => row.archetype !== null)
    expect(gauntlet.rivals.map((rival) => rival.archetypeId)).toEqual(
      archetypes.slice(0, 10).map((row) => row.archetype?.id),
    )
    const weights = gauntlet.rivals.reduce((sum, rival) => sum + rival.weight, 0)
    expect(weights).toBeCloseTo(1, 10)
    expect(gauntlet.coverage).toBeCloseTo(
      gauntlet.rivals.reduce((sum, rival) => sum + rival.share, 0),
      10,
    )
    for (const rival of gauntlet.rivals) {
      expect(rival.rank).toBe(0)
      expect(rival.list.archetypeId).toBe(rival.archetypeId)
      const best = rankArchetypeLists(rows.filter((row) => row.archetypeId === rival.archetypeId))[0]
      expect(rival.list.key).toBe(best?.key)
      expect(rival.weight).toBeCloseTo(rival.share / gauntlet.coverage, 10)
      expect(rival.energies.length).toBeGreaterThan(0)
    }
  })

  it('fase 42: games by weight — the same total, at least a quarter of the even share, the heaviest the most', () => {
    // 180 in all: 15 each, and the other 135 by weight (largest remainders).
    expect(gamesByWeight(60, [0.5, 0.3, 0.2])).toEqual([83, 55, 42])
    expect(gamesByWeight(10, [0.9, 0.1])).toEqual([10, 10])
    expect(gamesByWeight(100, [0.97, 0.01, 0.01, 0.01])).toEqual([316, 28, 28, 28])
    const many = gamesByWeight(60, [0.2, 0.15, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05, 0.03, 0.02])
    expect(many.reduce((sum, games) => sum + games, 0)).toBe(60 * 12)
    expect(Math.min(...many)).toBeGreaterThanOrEqual(15)
    expect(roundGames({ ...DEFAULT_EXPLORE_CONFIG, byWeight: false }, 60, [0.9, 0.1])).toEqual([60, 60])
    expect(exploreConfig({}).byWeight).toBe(true)
    expect(exploreConfig({}).confirmBot).toBe('e3')
    expect(exploreConfig({ confirmBot: null }).confirmBot).toBeNull()
    expect(robustnessOf('better')).toBe('robust')
    expect(robustnessOf('unclear')).toBe('bot_sensitive')
    expect(robustnessEs('bot_sensitive', 'e3')).toMatch(/^sensible al bot: con e3 no se sostiene/)
  })

  it('T-017 D3: the most played archetypes bring a second list, and share their weight with it', () => {
    const one = metaGauntlet(dataset, { size: 10 })
    const two = metaGauntlet(dataset, { size: 10, secondLists: 3 })
    const seconds = two.rivals.filter((rival) => rival.second)
    expect(seconds.length).toBeGreaterThan(0)
    expect(seconds.length).toBeLessThanOrEqual(3)
    expect(two.rivals).toHaveLength(one.rivals.length + seconds.length)
    expect(two.rivals.reduce((sum, rival) => sum + rival.weight, 0)).toBeCloseTo(1, 10)
    for (const second of seconds) {
      const at = two.rivals.indexOf(second)
      const first = two.rivals[at - 1]
      // Right after its archetype's first list, another list, the archetype's weight split by how often each was played.
      expect(first?.archetypeId).toBe(second.archetypeId)
      expect(first?.second).toBe(false)
      expect(second.list.key).not.toBe(first?.list.key)
      expect((first?.part ?? 0) + second.part).toBeCloseTo(1, 10)
      const alone = one.rivals.find((rival) => rival.archetypeId === second.archetypeId)
      expect((first?.weight ?? 0) + second.weight).toBeCloseTo(alone?.weight ?? 0, 10)
    }
    expect(secondListsFor(15)).toBe(3)
    expect(secondListsFor(5)).toBe(0)
  })

  it('a list the engine cannot play gives way to the next one of its archetype, or the archetype is skipped', () => {
    const plain = metaGauntlet(dataset, { size: 5 })
    const first = plain.rivals[0]
    if (!first) throw new Error('empty bank')
    const refused = new Set([first.list.key])
    const withNext = metaGauntlet(dataset, {
      size: 5,
      check: (list) => (refused.has(list.key) ? 'Helado de la Suerte no está implementada' : null),
    })
    const again = withNext.rivals.find((rival) => rival.archetypeId === first.archetypeId)
    if (again) {
      expect(again.rank).toBe(1)
      expect(again.list.key).not.toBe(first.list.key)
    } else {
      expect(withNext.skipped[0]).toMatchObject({ archetypeId: first.archetypeId })
    }
    const none = metaGauntlet(dataset, {
      size: 5,
      check: (list) => (list.archetypeId === first.archetypeId ? 'no simulable' : null),
    })
    expect(none.rivals).toHaveLength(5)
    expect(none.rivals.some((rival) => rival.archetypeId === first.archetypeId)).toBe(false)
    expect(none.skipped).toEqual([
      {
        archetypeId: first.archetypeId,
        archetypeName: first.archetypeName,
        share: first.share,
        reason: 'no simulable',
      },
    ])
  })
})

describe('meta score', () => {
  const record = (wins: number, losses: number, ties = 0) => ({ wins, losses, ties })

  it('the share-weighted win rate, ties as non-wins, with an interval around it', () => {
    const score = metaScore([
      { weight: 0.75, record: record(60, 40) },
      { weight: 0.25, record: record(20, 79, 1) },
    ])
    if (!score) throw new Error('no score')
    expect(score.value).toBeCloseTo(50, 10)
    expect(score.games).toBe(200)
    expect(score.rivals).toBe(2)
    expect(score.coverage).toBe(1)
    expect(score.ci95[0]).toBeLessThan(50)
    expect(score.ci95[1]).toBeGreaterThan(50)
    expect(formatMetaScoreEs(score)).toMatch(/^50 % contra el meta \(n = 200, IC \d+,\d–\d+,\d %\)$/)
  })

  it('renormalizes over the rivals with games and says how much of the bank that is', () => {
    const score = metaScore([
      { weight: 0.5, record: record(30, 10) },
      { weight: 0.5, record: record(0, 0) },
    ])
    expect(score?.value).toBeCloseTo(75, 10)
    expect(score?.coverage).toBeCloseTo(0.5, 10)
    expect(metaScore([{ weight: 1, record: record(0, 0) }])).toBeNull()
    expect(metaScore([])).toBeNull()
    expect(formatMetaScoreEs(null)).toBe('sin datos')
  })

  it('a rival won every time still adds uncertainty; more games narrow the interval', () => {
    const perfect = metaScore([{ weight: 1, record: record(40, 0) }])
    expect(perfect?.se).toBeGreaterThan(0)
    expect(perfect?.ci95[1]).toBe(100)
    const few = metaScore([{ weight: 1, record: record(20, 20) }])
    const many = metaScore([{ weight: 1, record: record(200, 200) }])
    if (!few || !many) throw new Error('no score')
    expect(many.ci95[1] - many.ci95[0]).toBeLessThan(few.ci95[1] - few.ci95[0])
  })

  it('a challenger beats the incumbent only by more than z standard errors of the difference', () => {
    const incumbent = metaScore([{ weight: 1, record: record(200, 200) }])
    const close = metaScore([{ weight: 1, record: record(21, 19) }])
    const far = metaScore([{ weight: 1, record: record(30, 10) }])
    if (!incumbent || !close || !far) throw new Error('no score')
    expect(scoreBeats(close, incumbent, 1)).toBe(false)
    expect(scoreBeats(far, incumbent, 1)).toBe(true)
    expect(scoreBeats(close, incumbent, 0)).toBe(true)
  })
})

describe('novelty', () => {
  const list = rows[0]
  if (!list) throw new Error('no lists')

  it('a list someone played is «jugada»; one or two changes away, «conocida»', () => {
    expect(novelty(rows, list.groups)).toMatchObject({ kind: 'played', closest: { key: list.key, swaps: 0 } })
    const pool = mutationPool({
      index,
      energies: ['fire', 'grass', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal'],
      edition: (groupId) => index.cardById(index.groupById(groupId)?.displayCardId ?? groupId) ?? null,
      maxCopies: () => 2,
    })
    const cards = list.cards.map((card) => ({ cardId: card.cardId as string, count: card.count }))
    const variant = variantOf(cards, ['fire'], pool, index, seededRandom(7), { swaps: 1, attempts: 400 })
    if (!variant) throw new Error('no variant')
    const result = novelty(rows, groupsOfCards(variant.cards, index))
    expect(result.kind).toBe('known')
    expect(result.closest?.swaps).toBeGreaterThanOrEqual(1)
    expect(result.closest?.swaps).toBeLessThanOrEqual(2)
    expect(result.nearbyLists).toBeGreaterThanOrEqual(1)
  })

  it('farther than six changes from every list of the era is «nueva»', () => {
    for (const number of [1, 2, 13, 21]) {
      const result = novelty(rows, groupsOfCards(deckDraft(number).cards, index))
      expect(result.kind).toBe(
        result.closest?.swaps === 0 ? 'played' : (result.closest?.swaps ?? 99) <= NOVELTY_MAX_SWAPS ? 'known' : 'new',
      )
    }
    expect(novelty([], new Map())).toEqual({ kind: 'new', closest: null, nearbyLists: 0, nearbyEntries: 0 })
  })
})

describe('variants (automatic search)', () => {
  const deck = deckDraft(2) // Mega-Blaziken ex with Rare Candy and no Combusken
  const energies = deck.energies as SelectableEnergy[]
  const pool = mutationPool({
    index,
    energies,
    edition: (groupId) => index.cardById(index.groupById(groupId)?.displayCardId ?? groupId) ?? null,
    maxCopies: () => 2,
  })

  it('the pool has trainers and only Pokémon that can attack with the deck energies or have an ability', () => {
    expect(pool.some((card) => index.cardById(card.cardId)?.cardType === 'trainer')).toBe(true)
    for (const card of pool) expect(usableWith(index.cardById(card.cardId) as never, energies)).toBe(true)
    const water = pool.find((card) => {
      const edition = index.cardById(card.cardId)
      return edition?.cardType === 'pokemon' && edition.ability === null && edition.energy === 'water'
    })
    if (water) {
      const edition = index.cardById(water.cardId)
      expect(edition?.attacks.some((attack) => attack.cost.every((type) => type === 'colorless'))).toBe(true)
    }
  })

  it('same seed, same variants; every variant is a valid deck, new, with as many cards in as out', () => {
    const run = (seed: number) => {
      const random = seededRandom(seed)
      const seen = new Set<string>()
      const out = []
      for (let i = 0; i < 8; i++) {
        const variant = variantOf(deck.cards, energies, pool, index, random, { seen })
        if (!variant) continue
        seen.add(variant.key)
        out.push(variant)
      }
      return out
    }
    const first = run(42)
    expect(first.length).toBeGreaterThanOrEqual(6)
    expect(run(42).map((variant) => variant.key)).toEqual(first.map((variant) => variant.key))
    expect(run(43).map((variant) => variant.key)).not.toEqual(first.map((variant) => variant.key))
    const baseKey = listKeyByGroup(groupsOfCards(deck.cards, index))
    expect(new Set(first.map((variant) => variant.key)).size).toBe(first.length)
    for (const variant of first) {
      expect(variant.key).not.toBe(baseKey)
      expect(validateDeck({ cards: variant.cards, energies }, index).errors).toEqual([])
      const total = (changes: { count: number }[]) => changes.reduce((sum, change) => sum + change.count, 0)
      expect(total(variant.add)).toBe(total(variant.remove))
      expect(total(variant.add)).toBeGreaterThanOrEqual(1)
      expect(total(variant.add)).toBeLessThanOrEqual(4)
      expect(cardChanges(deck.cards, variant.cards, index)).toEqual({ add: variant.add, remove: variant.remove })
    }
  })

  it('H-020: every card that stays keeps its place, and the snapshot plays the list in that order', () => {
    // The engine shuffles by position: the 20 cards as the deck text lists them, one by one.
    const slots = (cards: readonly { cardId: string; count: number }[]) =>
      cards.flatMap((entry) =>
        Array.from({ length: entry.count }, () => index.cardById(entry.cardId)?.functionalGroupId ?? entry.cardId),
      )
    const random = seededRandom(20)
    let checked = 0
    for (let i = 0; i < 40; i++) {
      const variant = variantOf(deck.cards, energies, pool, index, random, {})
      if (!variant) continue
      checked += 1
      const before = slots(deck.cards)
      const after = slots(variant.cards)
      expect(after).toHaveLength(20)
      const moved = after.filter((groupId, at) => groupId !== before[at]).length
      // Only the places of the copies that went out change (an incoming card can land where the same card already was).
      expect(moved).toBeLessThanOrEqual(variant.add.reduce((sum, change) => sum + change.count, 0))
      const snapshot = buildSnapshot({ label: 'v', cards: variant.cards, energies, index, engine: () => true })
      const played = snapshot.cards.flatMap((card) =>
        Array.from({ length: card.count }, () => index.cardById(card.cardId)?.functionalGroupId),
      )
      expect(played).toEqual(after)
    }
    expect(checked).toBeGreaterThan(30)
  })

  it('H-020: the snapshot merges only a line right after the same card', () => {
    const [first, second, third] = deck.cards
    if (!first || !second || !third) throw new Error('short deck')
    const cards = [
      { cardId: first.cardId, count: 1 },
      { cardId: first.cardId, count: 1 },
      { cardId: second.cardId, count: 1 },
      { cardId: first.cardId, count: 1 },
    ]
    const snapshot = buildSnapshot({ label: 'orden', cards, energies, index, engine: () => true })
    expect(snapshot.cards.map((card) => [card.cardId, card.count])).toEqual([
      [first.cardId, 2],
      [second.cardId, 1],
      [first.cardId, 1],
    ])
  })

  it('locked cards never go out; an evolution comes in with its pre-evolution', () => {
    const locked = new Set(
      deck.cards.map((entry) => index.cardById(entry.cardId)?.functionalGroupId).filter((id): id is string => !!id),
    )
    // Everything locked but one card: whatever goes in, only that card can go out.
    const free = deck.cards.find((entry) => index.cardById(entry.cardId)?.cardType === 'trainer' && entry.count === 2)
    if (!free) throw new Error('no free card')
    locked.delete(index.cardById(free.cardId)?.functionalGroupId as string)
    const random = seededRandom(5)
    for (let i = 0; i < 5; i++) {
      const variant = variantOf(deck.cards, energies, pool, index, random, { locked })
      if (!variant) continue
      for (const change of variant.remove) {
        expect(index.cardById(change.cardId)?.functionalGroupId).toBe(index.cardById(free.cardId)?.functionalGroupId)
      }
    }
    const stage1 = pool.find((card) => {
      const edition = index.cardById(card.cardId)
      return edition?.evolutionType === 'stage1' && pool.some((other) => other.nameEn === edition.evolvesFrom)
    })
    if (!stage1) throw new Error('no stage 1 in the pool')
    // The pre-evolution is drawn rarely: when the stage 1 comes, it brings it along.
    const pre = pool.filter((card) => card.nameEn === index.cardById(stage1.cardId)?.evolvesFrom)
    const only = [{ ...stage1, weight: 100 }, ...pre.map((card) => ({ ...card, weight: 0.01 }))]
    const variant = variantOf(deck.cards, energies, only, index, seededRandom(1), { swaps: 1, attempts: 200 })
    if (!variant) throw new Error('no variant with an evolution')
    expect(variant.add.map((change) => index.cardById(change.cardId)?.nameEn).sort()).toEqual(
      [stage1.nameEn, index.cardById(stage1.cardId)?.evolvesFrom].sort(),
    )
  })

  it('era and archetype usage: off-type Pokémon nobody plays stay out; the archetype core rarely goes out', () => {
    const affinity = neighborhoodUsage(dataset, deck.cards, index)
    const megaBlaziken = index.cardById('B1-36')?.functionalGroupId as string
    expect(affinity.get(megaBlaziken)).toBeGreaterThan(80)
    const usage = new Map(cardUsage(dataset.entries).map((row) => [row.groupId, row.share]))
    const weighted = mutationPool({
      index,
      energies,
      edition: (groupId) => index.cardById(index.groupById(groupId)?.displayCardId ?? groupId) ?? null,
      maxCopies: () => 2,
      usage: (groupId) => usage.get(groupId) ?? 0,
      affinity: (groupId) => affinity.get(groupId) ?? 0,
    })
    // Without usage data, only Pokémon of the deck's type (or with an ability) come in.
    for (const item of pool) {
      const card = index.cardById(item.cardId)
      if (card?.cardType === 'pokemon') expect(card.energy === 'fire' || card.ability !== null).toBe(true)
    }
    expect(weighted.length).toBeGreaterThan(pool.length)
    for (const item of weighted) {
      const card = index.cardById(item.cardId)
      if (card?.cardType !== 'pokemon' || card.energy === 'fire' || card.ability) continue
      expect((usage.get(item.groupId) ?? 0) + (affinity.get(item.groupId) ?? 0)).toBeGreaterThan(0)
    }
    // A staple trainer of the era weighs more than a trainer nobody plays.
    const byWeight = [...weighted].sort((a, b) => b.weight - a.weight)
    expect(index.cardById(byWeight[0]?.cardId ?? '')?.cardType).toBeDefined()
    expect(byWeight[0]?.weight).toBeGreaterThan(poolWeight('trainer', 0, 0))

    // What goes out: a card every similar list plays goes out ~10 times less often than one none plays.
    const torchic = index.cardById('B1-33')?.functionalGroupId as string
    const core = (groupId: string) => (groupId === megaBlaziken ? 100 : 0)
    const random = seededRandom(11)
    const out = new Map<string, number>()
    let variants = 0
    for (let i = 0; i < 120; i++) {
      const variant = variantOf(deck.cards, energies, weighted, index, random, { swaps: 1, affinity: core })
      if (!variant) continue
      variants += 1
      for (const change of variant.remove) {
        const groupId = index.cardById(change.cardId)?.functionalGroupId as string
        out.set(groupId, (out.get(groupId) ?? 0) + 1)
      }
    }
    expect(variants).toBeGreaterThan(90)
    // Both have two copies; Torchic is needed by the evolution line, so some of its draws fail validation.
    expect(out.get(torchic) ?? 0).toBeGreaterThan(0)
    expect((out.get(megaBlaziken) ?? 0) * 3).toBeLessThan(out.get(torchic) ?? 0)
  })

  it('with nothing new to try there is no variant', () => {
    expect(variantOf(deck.cards, energies, [], index, seededRandom(1))).toBeNull()
  })
})

describe('search rules', () => {
  it('config defaults and limits', () => {
    expect(exploreConfig()).toEqual(DEFAULT_EXPLORE_CONFIG)
    expect(
      exploreConfig({ gamesPerRival: 5, variantsPerRound: 99, maxRounds: 2.6, acceptZ: 0.5, pool: 'all' }),
    ).toMatchObject({ gamesPerRival: 10, variantsPerRound: 12, maxRounds: 3, acceptZ: 0.5, pool: 'all' })
    expect(exploreConfig({ pool: 'nope' as never }).pool).toBe('collection')
    // H-010: verification on by default; 0 games turns it off; z between 0 and 3.
    expect(DEFAULT_EXPLORE_CONFIG).toMatchObject({ confirmGames: 200, verifyGames: 120, verifyZ: 1.645 })
    expect(exploreConfig({ verifyGames: 0, verifyZ: 9 })).toMatchObject({ verifyGames: 0, verifyZ: 3 })
  })

  it('every list of a round plays the same seed against the same rival; rounds do not overlap', () => {
    expect(exploreSeed(1000, 0, 3)).toBe(1003)
    expect(exploreSeed(1000, 2, 3)).toBe(1000 + 2 * EXPLORE_SEED_STRIDE + 3)
  })

  it('a round winner has every pairing and beats the incumbent clearly', () => {
    const score = (wins: number, games: number) =>
      metaScore([{ weight: 1, record: { wins, losses: games - wins, ties: 0 } }])
    const incumbent = score(200, 400)
    expect(
      roundWinner(
        incumbent,
        [
          { id: 1, score: score(22, 40), complete: true },
          { id: 2, score: score(36, 40), complete: false },
          { id: 3, score: score(31, 40), complete: true },
        ],
        1,
      ),
    ).toBe(3)
    expect(roundWinner(incumbent, [{ id: 1, score: score(21, 40), complete: true }], 1)).toBeNull()
    expect(roundWinner(null, [{ id: 4, score: score(10, 40), complete: true }], 1)).toBe(4)
    expect(roundWinner(incumbent, [], 1)).toBeNull()
  })

  it('games per round and at most (every round verified, plus the confirmation)', () => {
    expect(exploreGames(DEFAULT_EXPLORE_CONFIG, 10)).toEqual({
      perRound: 9 * 10 * 60,
      max: (9 * 10 * 60 + 2 * 10 * 120) * 12 + 2 * 10 * 200,
    })
    expect(exploreGames({ ...DEFAULT_EXPLORE_CONFIG, verifyGames: 0 }, 10).max).toBe(9 * 10 * 60 * 12 + 2 * 10 * 200)
  })

  it('H-010: the verification and the confirmation ask for a clear win on fresh games', () => {
    const score = (wins: number, games: number) =>
      metaScore([{ weight: 1, record: { wins, losses: games - wins, ties: 0 } }])
    // 60 % against 50 % over 400 games each: ~2,8 standard errors apart.
    expect(verifyAccepts(score(240, 400), score(200, 400), 1.645)).toBe(true)
    // 53 % against 50 %: not enough.
    expect(verifyAccepts(score(212, 400), score(200, 400), 1.645)).toBe(false)
    expect(verifyAccepts(null, score(200, 400), 1.645)).toBe(false)

    const better = confirmVerdict(score(240, 400), score(200, 400), 1.645)
    expect(better?.verdict).toBe('better')
    expect(better?.difference.value).toBeCloseTo(10, 8)
    expect(better?.difference.ci95[0]).toBeGreaterThan(0)
    expect(confirmVerdict(score(212, 400), score(200, 400), 1.645)?.verdict).toBe('unclear')
    expect(confirmVerdict(score(160, 400), score(200, 400), 1.645)?.verdict).toBe('worse')
    expect(confirmVerdict(null, score(200, 400), 1.645)).toBeNull()

    const difference = scoreDifference(score(240, 400) as MetaScore, score(200, 400) as MetaScore)
    expect(formatDifferenceEs(difference)).toMatch(/^\+10,0 puntos \(IC \+\d+,\d a \+\d+,\d\)$/u)
    expect(formatDifferenceEs({ value: -2.5, se: 1, ci95: [-4.5, -0.5] })).toBe('−2,5 puntos (IC −4,5 a −0,5)')
  })
})
