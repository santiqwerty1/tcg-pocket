/**
 * What the app knows about the engine before a worker reports `engine-cli status`: at deckgym fb792ebf every card
 * is implemented except these 46 B4b trainer reprints (docs/fase0/deckgym-no-implementadas-fb792ebf.json), which are
 * played as an implemented edition of the same card (snapshot.ts).
 */
import type { EngineStatus } from './snapshot.js'

export const FALLBACK_ENGINE_REV = 'fb792ebfbaca995af9750c28101ce92a51282825'

export const UNIMPLEMENTED_AT_FB792EBF: ReadonlySet<string> = new Set([
  'B4b 198',
  'B4b 199',
  'B4b 200',
  'B4b 201',
  'B4b 202',
  'B4b 203',
  'B4b 212',
  'B4b 213',
  'B4b 214',
  'B4b 215',
  'B4b 216',
  'B4b 217',
  'B4b 218',
  'B4b 219',
  'B4b 220',
  'B4b 221',
  'B4b 222',
  'B4b 223',
  'B4b 224',
  'B4b 225',
  'B4b 226',
  'B4b 364',
  'B4b 365',
  'B4b 366',
  'B4b 367',
  'B4b 368',
  'B4b 369',
  'B4b 378',
  'B4b 379',
  'B4b 380',
  'B4b 381',
  'B4b 382',
  'B4b 383',
  'B4b 384',
  'B4b 385',
  'B4b 386',
  'B4b 387',
  'B4b 388',
  'B4b 389',
  'B4b 390',
  'B4b 391',
  'B4b 392',
  'B4b 421',
  'B4b 422',
  'B4b 423',
  'B4b 424',
])

/** Status of an engine card from the fallback list (only for engine fb792ebf). */
export const fallbackEngineStatus: EngineStatus = (engineId) => !UNIMPLEMENTED_AT_FB792EBF.has(engineId)
