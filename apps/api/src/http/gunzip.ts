/**
 * H-015 (Fase 36): every gzip the API inflates has a ceiling. Replays inflate to a few MB; a body that inflates past
 * this is not one of ours (a small gzip of zeros can inflate to gigabytes and take the 512 MB machine down).
 */
import { gunzipSync } from 'node:zlib'

export const MAX_INFLATED_BYTES = 64 * 1024 * 1024

/** Inflates and parses a gzipped JSON; throws (RangeError) past `maxBytes`. */
export function gunzipJson<T = unknown>(bytes: Uint8Array, maxBytes = MAX_INFLATED_BYTES): T {
  return JSON.parse(gunzipSync(bytes, { maxOutputLength: maxBytes }).toString('utf8')) as T
}
