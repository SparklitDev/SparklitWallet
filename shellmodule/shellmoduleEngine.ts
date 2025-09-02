import fetch, { RequestInit, HeadersInit } from "node-fetch"
import { z } from "zod"
import type { VaultMetric } from "../cryptureVaultTypes"

/* ----------------------------------------------------------------------------
 * Schemas
 * -------------------------------------------------------------------------- */

const VaultMetricSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    totalValueLocked: z.number(),
    collateralRatio: z.number(),
  })
  .passthrough() // allow extra fields from API without failing

const SnapshotsResponseSchema = z.object({
  snapshots: z.array(VaultMetricSchema),
  nextCursor: z.string().optional(),
  prevCursor: z.string().optional(),
})

/* ----------------------------------------------------------------------------
 * Options & Params
 * -------------------------------------------------------------------------- */

export interface ShellmoduleEngineOptions {
  /** Number of retries on failure (default: 2) */
  retries?: number
  /** Per-request timeout in ms (default: 8000) */
  timeoutMs?: number
  /** Linear backoff base in ms; wait = attempt * base (default: 300) */
  backoffBaseMs?: number
  /** Optional headers that will be merged into each request */
  headers?: Record<string, string>
  /** Optional User-Agent header */
  userAgent?: string
}

export interface FetchSnapshotsParams {
  /** Page size (default: 50) */
  limit?: number
  /** Pagination cursor */
  cursor?: string
  /** Abort controller signal */
  signal?: AbortSignal
}

export interface FetchAllSnapshotsParams {
  /** Page size per call (default: 200) */
  limitPerPage?: number
  /** Safety cap on the number of pages to fetch (default: 20) */
  maxPages?: number
  /** If set, stop when reaching snapshots older than this unix-seconds timestamp */
  sinceTs?: number
  /** If set, stop when reaching snapshots newer than this unix-seconds timestamp */
  untilTs?: number
  /** Abort controller signal */
  signal?: AbortSignal
}

/* ----------------------------------------------------------------------------
 * Engine
 * -------------------------------------------------------------------------- */

export class ShellmoduleEngine {
  private readonly apiUrl: string
  private readonly apiKey: string
  private readonly retries: number
  private readonly timeoutMs: number
  private readonly backoffBaseMs: number
  private readonly baseHeaders: Record<string, string>

  constructor(apiUrl: string, apiKey: string, options: ShellmoduleEngineOptions = {}) {
    if (!apiUrl || typeof apiUrl !== "string") {
      throw new TypeError(`"apiUrl" must be a non-empty string`)
    }
    if (!apiKey || typeof apiKey !== "string") {
      throw new TypeError(`"apiKey" must be a non-empty string`)
    }

    this.apiUrl = apiUrl.replace(/\/+$/, "")
    this.apiKey = apiKey

    this.retries = options.retries ?? 2
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.backoffBaseMs = Math.max(0, options.backoffBaseMs ?? 300)
    this.baseHeaders = {
      ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
      ...(options.headers ?? {}),
    }

    if (!Number.isInteger(this.retries) || this.retries < 0) {
      throw new RangeError(`"retries" must be a non-negative integer (got ${options.retries})`)
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError(`"timeoutMs" must be a positive integer (got ${options.timeoutMs})`)
    }
  }

  /* ------------------------------------------------------------------------
   * Public API
   * ---------------------------------------------------------------------- */

  /**
   * Fetch a single page of snapshot metrics for a specific contract.
   * Returns snapshots sorted by ascending timestamp, plus an optional nextCursor.
   */
  public async fetchSnapshots(
    contractAddress: string,
    params: number | FetchSnapshotsParams = {}
  ): Promise<{ snapshots: VaultMetric[]; nextCursor?: string }> {
    const { limit, cursor, signal } =
      typeof params === "number"
        ? { limit: params, cursor: undefined, signal: undefined }
        : {
            limit: params.limit ?? 50,
            cursor: params.cursor,
            signal: params.signal,
          }

    if (!contractAddress || typeof contractAddress !== "string") {
      throw new TypeError("contractAddress must be a non-empty string")
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`limit must be a positive integer (got ${limit})`)
    }

    const qs = new URLSearchParams({
      address: contractAddress,
      limit: String(limit),
    })
    if (cursor) qs.set("cursor", cursor)

    const url = `${this.apiUrl}/shellmodule/snapshots?${qs.toString()}`
    const { json } = await this.request(url, { method: "GET", signal })

    const validated = SnapshotsResponseSchema.parse(json)
    const sorted = validated.snapshots
      .map(s => s as VaultMetric)
      .sort((a, b) => a.timestamp - b.timestamp)

    return { snapshots: sorted, nextCursor: validated.nextCursor }
  }

  /**
   * Convenience: fetch multiple pages until `maxPages`, or bounds (`sinceTs`/`untilTs`) are met.
   * Returns snapshots sorted by ascending timestamp.
   */
  public async fetchAllSnapshots(
    contractAddress: string,
    params: FetchAllSnapshotsParams = {}
  ): Promise<VaultMetric[]> {
    const limitPerPage = Math.max(1, Math.floor(params.limitPerPage ?? 200))
    const maxPages = Math.max(1, Math.floor(params.maxPages ?? 20))
    const sinceTs = params.sinceTs
    const untilTs = params.untilTs
    const signal = params.signal

    let cursor: string | undefined
    const out: VaultMetric[] = []

    for (let page = 0; page < maxPages; page++) {
      const { snapshots, nextCursor } = await this.fetchSnapshots(contractAddress, {
        limit: limitPerPage,
        cursor,
        signal,
      })

      // apply bounds if provided
      const filtered = snapshots.filter(s => {
        if (sinceTs != null && s.timestamp < sinceTs) return false
        if (untilTs != null && s.timestamp > untilTs) return false
        return true
      })

      out.push(...filtered)

      // stop if:
      // - no more pages
      // - page returned fewer than we requested (likely last page)
      // - bounds indicate we’ve already covered the desired range
      const stopForBounds =
        (sinceTs != null && snapshots.some(s => s.timestamp <= sinceTs)) ||
        (untilTs != null && snapshots.some(s => s.timestamp >= untilTs))

      if (!nextCursor || snapshots.length < limitPerPage || stopForBounds) break
      cursor = nextCursor
    }

    // ensure overall ascending order (in case of partial-page bounds)
    out.sort((a, b) => a.timestamp - b.timestamp)
    return out
  }

  /* ------------------------------------------------------------------------
   * Internals
   * ---------------------------------------------------------------------- */

  private buildHeaders(extra?: Record<string, string>): HeadersInit {
    return {
      accept: "application/json",
      authorization: `Bearer ${this.apiKey}`,
      ...this.baseHeaders,
      ...(extra ?? {}),
    }
  }

  private async request(
    url: string,
    init: RequestInit & { signal?: AbortSignal }
  ): Promise<{ json: unknown; status: number }> {
    let attempt = 0
    let lastErr: unknown

    const headers = this.buildHeaders(init.headers as Record<string, string> | undefined)
    const baseInit: RequestInit = { ...init, headers }

    while (attempt <= this.retries) {
      attempt++
      try {
        const res = await this.fetchWithTimeout(url, baseInit, this.timeoutMs)
        const status = res.status

        if (res.ok) {
          // happy path
          const json = await res.json()
          return { json, status }
        }

        // Non-2xx: get a short body for diagnostics
        const bodyText = await this.safeText(res)

        // Retry on known-transient statuses
        const retryable = status === 408 || status === 429 || status >= 500
        if (!retryable || attempt > this.retries) {
          throw new Error(`HTTP ${status}${bodyText ? `: ${bodyText}` : ""}`)
        }

        // Honor Retry-After when present
        const retryAfter = Number(res.headers.get("retry-after"))
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.round(retryAfter * 1000)
            : this.backoffBaseMs * attempt
        await this.sleep(waitMs)
      } catch (err: any) {
        lastErr = err
        // Abort error or generic network error
        if (err?.name === "AbortError") {
          if (attempt > this.retries) break
        }
        if (attempt > this.retries) break
        await this.sleep(this.backoffBaseMs * attempt)
      }
    }

    const msg =
      lastErr instanceof Error ? lastErr.message : typeof lastErr === "string" ? lastErr : "Unknown error"
    throw new Error(`❌ Failed to fetch snapshots after ${this.retries + 1} attempt(s): ${msg}`)
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)

    // If caller passed a signal, propagate cancellation
    const inputSignal = init.signal as AbortSignal | undefined
    const onAbort = () => controller.abort()
    if (inputSignal) inputSignal.addEventListener("abort", onAbort, { once: true })

    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(t)
      if (inputSignal) inputSignal.removeEventListener("abort", onAbort)
    }
  }

  private async safeText(res: Response): Promise<string> {
    try {
      const txt = await res.text()
      // trim & cap noise
      const s = txt.trim()
      return s.length > 300 ? s.slice(0, 300) + "…" : s
    } catch {
      return ""
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}
