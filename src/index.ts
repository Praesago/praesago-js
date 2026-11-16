/** Client for the Praesago API: England and Wales property and area data. */

export const VERSION = '0.1.0'
const DEFAULT_BASE_URL = 'https://praesago.com'
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])

export type Json = any

export interface PraesagoOptions {
  /** API key. Defaults to process.env.PRAESAGO_API_KEY when it exists. */
  apiKey?: string
  baseUrl?: string
  /** Request timeout in milliseconds (default 30000). */
  timeout?: number
  /** Retries for 429 and 5xx replies and network faults (default 2). */
  maxRetries?: number
  /** Custom fetch, for tests or older runtimes. */
  fetch?: typeof fetch
}

export interface Credits {
  charged: number | null
  remaining: number | null
}

export interface ScreenFilters {
  min_median_price_gbp?: number
  max_median_price_gbp?: number
  min_asking_rent_pcm?: number
  max_asking_rent_pcm?: number
  min_sale_listings?: number
  min_price_cut_pct?: number
  max_price_cut_pct?: number
  min_yield_pct?: number
  max_yield_pct?: number
  region?: string
  sort_by?: 'price' | 'rent' | 'listings' | 'price_cut' | 'yield'
  order?: 'asc' | 'desc'
  limit?: number
}

type Params = Record<string, string | number | boolean | undefined | null>

/** Every error the client throws. Branch on `code` (stable), not on the message. */
export class PraesagoError extends Error {
  status: number | null
  code: string | null
  requestId: string | null
  retryAfter: number | null
  details: Json
  constructor(message: string, opts: { status?: number | null; code?: string | null; requestId?: string | null; retryAfter?: number | null; details?: Json } = {}) {
    super(message)
    this.name = new.target.name
    this.status = opts.status ?? null
    this.code = opts.code ?? null
    this.requestId = opts.requestId ?? null
    this.retryAfter = opts.retryAfter ?? null
    this.details = opts.details ?? null
  }
}
/** 401: the key is missing or not valid. */
export class AuthenticationError extends PraesagoError {}
/** 402: not enough credits. Buy more at https://praesago.com/pricing. */
export class InsufficientCreditsError extends PraesagoError {}
/** 404: no such postcode district (England and Wales only). */
export class NotFoundError extends PraesagoError {}
/** 429: too many requests. */
export class RateLimitError extends PraesagoError {}
/** 400: a parameter is not valid. */
export class BadRequestError extends PraesagoError {}
/** 5xx: a fault on the Praesago side. Quote requestId to support. */
export class ServerError extends PraesagoError {}

function errorClass(status: number): typeof PraesagoError {
  if (status === 401) return AuthenticationError
  if (status === 402) return InsufficientCreditsError
  if (status === 404) return NotFoundError
  if (status === 429) return RateLimitError
  if (status === 400) return BadRequestError
  if (status >= 500) return ServerError
  return PraesagoError
}

function envKey(): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return g.process?.env?.PRAESAGO_API_KEY
}

function seg(district: string): string {
  return encodeURIComponent(district.trim().toUpperCase().replace(/\s+/g, ''))
}

function int(v: string | null): number | null {
  if (v === null) return null
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Praesago {
  readonly apiKey: string | undefined
  readonly baseUrl: string
  readonly timeout: number
  readonly maxRetries: number
  /** Credit headers from the last reply. */
  lastCredits: Credits = { charged: null, remaining: null }
  private readonly fetchImpl: typeof fetch

  constructor(options: PraesagoOptions = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : envKey()
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeout = options.timeout ?? 30000
    this.maxRetries = options.maxRetries ?? 2
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  // ---- district data ----
  /** Everything held for one postcode district. `sections` limits the reply. */
  district(district: string, sections?: string[]): Promise<Json> {
    return this.get(`/api/agent/v1/district/${seg(district)}`, { sections: sections?.length ? sections.join(',') : undefined })
  }
  context(district: string): Promise<Json> { return this.get(`/api/v1/districts/${seg(district)}/context`) }
  /** Sold prices by postcode sector (a median needs 10 or more sales). */
  sectors(district: string): Promise<Json> { return this.get(`/api/v1/districts/${seg(district)}/sectors`) }
  soldPsf(district: string): Promise<Json> { return this.get(`/api/v1/districts/${seg(district)}/sold-psf`) }
  rental(district: string): Promise<Json> { return this.get(`/api/v1/districts/${seg(district)}/rental`) }
  priceHistory(district: string, opts: { months?: number } = {}): Promise<Json> {
    return this.get(`/api/v1/districts/${seg(district)}/price-history`, opts)
  }
  planning(district: string, opts: { months?: number } = {}): Promise<Json> { return this.get(`/api/v1/planning/${seg(district)}`, opts) }
  /** Weekly asking-market statistics. */
  listings(district: string, opts: { channel?: 'sale' | 'rent'; weeks?: number; source?: 'rightmove' | 'onthemarket' } = {}): Promise<Json> {
    return this.get(`/api/v1/listings/${seg(district)}`, opts)
  }

  // ---- many districts ----
  movers(opts: { channel?: 'sale' | 'rent'; metric?: 'price' | 'inventory'; limit?: number } = {}): Promise<Json> {
    return this.get('/api/v1/listings/movers', opts)
  }
  search(q: string, opts: { limit?: number } = {}): Promise<Json> { return this.get('/api/v1/districts/search', { q, ...opts }) }
  screen(filters: ScreenFilters = {}): Promise<Json> { return this.get('/api/v1/screen', filters as Params) }
  compare(a: string, b: string): Promise<Json> { return this.get('/api/v1/compare', { a, b }) }
  /** Headline facts for up to 50 districts (1 credit for each district found). */
  batch(districts: string[]): Promise<Json> { return this.request('POST', '/api/v1/districts/batch', undefined, { districts }) }

  // ---- no key needed ----
  catalogue(): Promise<Json> { return this.get('/api/v1/catalogue') }
  demo(): Promise<Json> { return this.get('/api/v1/demo') }

  // ---- transport ----
  private get(path: string, params?: Params): Promise<Json> { return this.request('GET', path, params) }

  private async request(method: string, path: string, params?: Params, body?: unknown): Promise<Json> {
    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    const headers: Record<string, string> = { Accept: 'application/json' }
    // Browsers forbid setting User-Agent, and an extra header could fail a CORS check, so set it only outside a browser.
    if (typeof (globalThis as { window?: unknown }).window === 'undefined') headers['User-Agent'] = `praesago-js/${VERSION}`
    if (this.apiKey) headers['X-API-Key'] = this.apiKey
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeout),
        })
      } catch (err) {
        if (attempt < this.maxRetries) { await sleep(backoff(null, attempt + 1)); continue }
        throw new PraesagoError(`Network error: ${(err as Error).message}`, { code: 'network' })
      }
      this.lastCredits = { charged: int(res.headers.get('X-Credits-Charged')), remaining: int(res.headers.get('X-Credits-Remaining')) }
      const text = await res.text()
      let payload: Json = null
      try { payload = JSON.parse(text) } catch { payload = null }

      if (res.ok && payload && typeof payload === 'object' && payload.success !== false) return payload.data
      if (!res.ok && RETRY_STATUSES.has(res.status) && attempt < this.maxRetries) {
        await sleep(backoff(res.headers.get('Retry-After'), attempt + 1))
        continue
      }
      if (res.ok && (payload === null || typeof payload !== 'object')) {
        throw new PraesagoError('The server sent a reply that is not JSON', { status: res.status, code: 'bad_response' })
      }
      const Cls = errorClass(res.status)
      throw new Cls(payload?.error ?? `HTTP ${res.status}${payload ? '' : ' (reply is not JSON)'}`, {
        status: res.status,
        code: payload?.code ?? null,
        requestId: payload?.request_id ?? null,
        retryAfter: int(res.headers.get('Retry-After')),
        details: payload,
      })
    }
  }
}

function backoff(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const s = Number(retryAfter)
    if (!Number.isNaN(s)) return Math.min(s, 30) * 1000
  }
  return Math.min(500 * 2 ** (attempt - 1), 8000)
}

export default Praesago
