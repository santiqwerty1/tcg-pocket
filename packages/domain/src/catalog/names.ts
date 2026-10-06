/**
 * Localized card names. Faithful port of the tracker's `getCardNameByLang`
 * (`refs/tracker/frontend/src/lib/utils.ts:55-89`, GPL-3.0; logic described in docs/fase0/catalogo.md §2.1):
 * - pokémon: key = name without the trailing ' ex', lower-cased, looked up in pokemon_translations; ' ex' re-appended;
 * - trainer item/tool/stadium: tools_translations; supporter: trainers_translations; anything else: English name.
 * A missing key or a null/empty translation falls back to the English name (source 'fallback_en').
 */
import type { TranslationTable } from './schemas.js'
import type { CardType, EvolutionType } from './types.js'

export interface NameTranslations {
  pokemon: TranslationTable
  trainers: TranslationTable
  tools: TranslationTable
}

/** The fields of a card that drive the lookup (works for raw tracker rows once mapped and for CardEdition). */
export interface NameInput {
  name: string
  cardType: CardType
  evolutionType: EvolutionType
  ex: boolean
}

export type NameSource = 'tracker' | 'fallback_en'

export interface LocalizedName {
  name: string
  source: NameSource
}

/** Locale keys used by the tracker's translation files. */
export type TranslationLang = 'en-US' | 'fr-FR' | 'es-ES' | 'pt-BR' | 'it-IT' | 'de-DE'

const EX_SUFFIX = ' ex'

function lookup(table: TranslationTable, key: string, lang: TranslationLang): string | null {
  const entry = table[key.toLowerCase()]
  if (!entry) return null
  const translated = entry[lang]
  return translated ? translated : null
}

export function cardNameByLang(card: NameInput, translations: NameTranslations, lang: TranslationLang): LocalizedName {
  if (card.cardType === 'pokemon') {
    // The tracker slices 3 characters when `ex` is set; `ex` equals `name.includes(' ex')` for every card.
    const baseName = card.ex && card.name.endsWith(EX_SUFFIX) ? card.name.slice(0, -EX_SUFFIX.length) : card.name
    const translated = lookup(translations.pokemon, baseName, lang)
    if (translated === null) return { name: card.name, source: 'fallback_en' }
    return { name: card.ex ? `${translated}${EX_SUFFIX}` : translated, source: 'tracker' }
  }
  const table =
    card.evolutionType === 'item' || card.evolutionType === 'tool' || card.evolutionType === 'stadium'
      ? translations.tools
      : card.evolutionType === 'supporter'
        ? translations.trainers
        : null
  const translated = table ? lookup(table, card.name, lang) : null
  if (translated === null) return { name: card.name, source: 'fallback_en' }
  return { name: translated, source: 'tracker' }
}

/** Spanish (es-ES) name of a card, as the tracker exports it in the CSV `CardName` column. */
export function cardNameEs(card: NameInput, translations: NameTranslations): { nameEs: string; source: NameSource } {
  const localized = cardNameByLang(card, translations, 'es-ES')
  return { nameEs: localized.name, source: localized.source }
}
