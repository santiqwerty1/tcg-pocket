import type { ZodType } from 'zod'
import { apiErrorBodySchema } from './schemas'
import { resetClientAndLogin } from './session'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue>

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Plain objects are sent as JSON; FormData is sent as multipart. */
  body?: unknown
  query?: Query
  /** Validates the JSON response; a mismatch throws ApiError('invalid_response'). */
  schema?: ZodType<T>
  signal?: AbortSignal
  headers?: Record<string, string>
}

export function buildUrl(path: string, query?: Query): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** Hook used on 401; replaced in tests. */
let unauthenticatedHandler: () => void | Promise<void> = () => resetClientAndLogin()
export function setUnauthenticatedHandler(handler: () => void | Promise<void>): void {
  unauthenticatedHandler = handler
}

/** Maps the contract's `{ error: { code, message } }` and Nest's default `{ statusCode, message }` to an ApiError. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const parsed = apiErrorBodySchema.safeParse(body)
  if (parsed.success) {
    const { code, message, details } = parsed.data.error
    return new ApiError(response.status, code, message, details)
  }
  if (body && typeof body === 'object') {
    const nest = body as { message?: unknown; error?: unknown; code?: unknown }
    const message = Array.isArray(nest.message)
      ? nest.message.join(' ')
      : typeof nest.message === 'string'
        ? nest.message
        : defaultMessage(response.status)
    const code =
      typeof nest.code === 'string'
        ? nest.code
        : typeof nest.error === 'string'
          ? snake(nest.error)
          : `http_${response.status}`
    return new ApiError(response.status, code, message, body)
  }
  return new ApiError(response.status, `http_${response.status}`, defaultMessage(response.status))
}

function snake(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '_')
}

function defaultMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Necesitás iniciar sesión.'
    case 403:
      return 'No tenés permiso para hacer eso.'
    case 404:
      return 'No se encontró lo que buscabas.'
    case 409:
      return 'Hay un conflicto con el estado actual.'
    case 429:
      return 'Demasiados intentos; esperá un rato.'
    default:
      return status >= 500 ? 'El servidor falló. Probá de nuevo en un momento.' : `Error ${status}.`
  }
}

export async function request<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, query, schema, signal, headers = {} } = options
  const init: RequestInit = { method, credentials: 'same-origin', headers, signal: signal ?? null }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json', ...headers }
  }
  init.headers = { Accept: 'application/json', ...(init.headers as Record<string, string>) }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), init)
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new ApiError(0, 'network', 'Sin conexión con el servidor.', cause)
  }

  if (response.status === 401) {
    const error = await errorFromResponse(response)
    void unauthenticatedHandler()
    throw new ApiError(401, 'unauthenticated', error.message)
  }
  if (!response.ok) throw await errorFromResponse(response)
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T

  const text = await response.text()
  if (text.length === 0) return undefined as T
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ApiError(response.status, 'invalid_response', 'La API devolvió algo que no es JSON.', text.slice(0, 200))
  }
  if (!schema) return data as T
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first ? first.path.join('.') || '(raíz)' : ''
    throw new ApiError(
      response.status,
      'invalid_response',
      `La respuesta de ${path} no tiene la forma esperada${where ? ` (${where}: ${first?.message})` : ''}.`,
      parsed.error.issues,
    )
  }
  return parsed.data
}

/** Fetches a text body (deck exports). */
export async function requestText(path: string, query?: Query): Promise<string> {
  const response = await fetch(buildUrl(path, query), { credentials: 'same-origin' })
  if (response.status === 401) {
    void unauthenticatedHandler()
    throw new ApiError(401, 'unauthenticated', 'Necesitás iniciar sesión.')
  }
  if (!response.ok) throw await errorFromResponse(response)
  return response.text()
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8?.[1]) return decodeURIComponent(utf8[1])
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain?.[1] ?? null
}

/** Downloads a file served by the API (CSV, backups) keeping the server's file name when it sends one. */
export async function downloadFile(path: string, fallbackName: string, query?: Query): Promise<string> {
  const response = await fetch(buildUrl(path, query), { credentials: 'same-origin' })
  if (response.status === 401) {
    void unauthenticatedHandler()
    throw new ApiError(401, 'unauthenticated', 'Necesitás iniciar sesión.')
  }
  if (!response.ok) throw await errorFromResponse(response)
  const blob = await response.blob()
  const name = fileNameFromDisposition(response.headers.get('content-disposition')) ?? fallbackName
  saveBlob(blob, name)
  return name
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message
  if (error instanceof Error) return error.message
  return 'Algo salió mal.'
}
