import type { Response } from 'express'

/** A request body can finish while its response still long-polls: watch the response connection. */
export function abortOnClose(response: Response): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const disconnected = () => controller.abort()
  response.once('close', disconnected)
  if (response.destroyed) disconnected()
  return { signal: controller.signal, dispose: () => response.off('close', disconnected) }
}
