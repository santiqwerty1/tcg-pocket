import type { CardLineView } from '../lab/lab-views.js'

/**
 * A card of the Laboratorio as Claude reads it: «2 Onix (A1-150)». Self-review of the #107 follow-up: a name that
 * already carries its code (two cards of the name) does not get another; review of #113: codes with lowercase letters
 * too (B1a, A2b, B4a…).
 */
export const cardLine = (card: CardLineView) =>
  /\([A-Za-z0-9-]+\)$/.test(card.nameEs)
    ? `${card.count} ${card.nameEs}`
    : `${card.count} ${card.nameEs} (${card.cardId})`
