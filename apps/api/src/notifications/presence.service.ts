/** Fase 18: which pages the owner is looking at right now, so a «te toca» is not pushed while the game is open. */
import { Global, Injectable, Module } from '@nestjs/common'

/** A page polled within this window counts as open. */
export const PRESENCE_WINDOW_MS = 20_000

@Injectable()
export class PresenceService {
  private readonly seen = new Map<string, number>()

  saw(key: string, now = Date.now()): void {
    this.seen.set(key, now)
  }

  isWatching(key: string, now = Date.now()): boolean {
    const at = this.seen.get(key)
    return at !== undefined && now - at < PRESENCE_WINDOW_MS
  }
}

@Global()
@Module({ providers: [PresenceService], exports: [PresenceService] })
export class PresenceModule {}
