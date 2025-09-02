// File: fluxcoreEngine.ts
import fetch, { HeadersInit, RequestInit } from "node-fetch"
import { z } from "zod"
import type { VaultMetric } from "../cryptureVaultTypes"

/** Zod schemas to validate and normalize API payloads */
const MetricSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    volume: z.number(),
    activeAddresses: z.number().int().nonnegative().optional().default(0),
  })
  .transform(m => ({ ...m, activeAddresses: m.activeAddresses ?? 0 }))

const MetricsEnvelopeSchema = z.object({
  data: z.array(MetricSchema),
})

export interface FetchMetricsOptions {
  /** Lookback window in hours (required unless using fromTs/toTs) */
  hours?: number
  /** Optional explicit time bounds in unix seconds */
  fromTs?: number
  toTs?: number
  /** Optional AbortSignal for cancellation */
  signal?: AbortSignal
  /** Per-request timeout (ms). Default: 10_000 */
  timeoutMs?: number
  /** Retry attempts for 429/5xx/timeouts. Default: 2 */
  retries?: number
  /** Linear backoff base (ms). Wait = attempt * base. Default: 300 */
  backoffBaseMs?: number
  /** Extra headers merged into the request */
  headers?: Record<string, string>
  /** Optional User-Agent header */
  userAgent?: string
}

/**
 * FluxcoreEngine: resilient HTTP client for Fluxcore metrics API
 * - Input validation
 * - Timeouts, retries with linear backoff, and Retry-After support
 * - Strong typing of response payloads
 */
export class FluxcoreEngine {
  private readonly apiBase: string
  private apiKey?: string

  constructor(apiBase: string, apiKey?: string) {
    this.apiBase = apiBase.replace(/\/+$/, "")
    this.apiKey = apiKey
  }

  /** Update the API key at runtime (optional) */
  setApiKey(key?: string) {
    this.apiKey = key
  }

  /**
   * Fetch raw metric data for a given contract and options.
   * Returns metrics sorted by ascending timestamp.
   */
  async fetchMetrics(
    contractAddress: string,
    opts: number | FetchMetricsOptions
  ): Promise<VaultMetric[]> {
    const options: Required<FetchMetricsOptions> = {
      hours: typeof opts === "number" ? opts : opts.hours ?? 24,
      fromTs: typeof opts === "number" ? undefined : opts.fromTs ?? undefined,
      toTs: typeof opts === "number" ? undefined : opts.toTs ?? undefined,
      signal: typeof opts === "number" ? undefined : opts.signal ?? undefined,
      timeoutMs: typeof opts === "number" ? 10_000 : Math.max(1_000, opts.timeoutMs ?? 10_000),
      retries: typeof opts === "number" ? 2 : Math.max(0, opts.retries ?? 2),
      backoffBaseMs: typeof opts === "number" ? 300 : Math.max(0, opts.backoffBaseMs ?? 300),
      headers: typeof opts === "number" ? {} : opts.headers ?? {},
      userAgent: typeof opts === "number" ? "fluxcore-engine/1.0" : (opts.userAgent || "fluxcore-engine/1.0"),
    }

    if (!contractAddress?.trim()) {
      throw new Error("contractAddress is required")
    }
    if (!options.hours && !options.fromTs && !options.toTs) {
      throw new Error("Either hours or fromTs/toTs must be provided")
    }

    const params = new URLSearchParams()
    params.set("address", contractAddress)
    if (options.hours) params.set("hours", String(Math.floor(options.hours)))
    if (options.fromTs) params.set("from", String(Math.floor(options.fromTs)))
    if (options.toTs) params.set("to", String(Math.floor(options.toTs)))

    const url = `${this.apiBase}/fluxcore/metrics?${params.toString()}`
    const headers = this.buildHeaders(options.headers, options.userAgent)

    let attempt = 0
    let lastErr: unknown

    while (attempt <= options.retries) {
      attempt++
      try {
        const res = await this.fetchWithTimeout(
          url,
          { method: "GET", headers, signal: options.signal },
          options.timeoutMs
        )

        if (res.ok) {
          const json = await res.json()
          const parsed = MetricsEnvelopeSchema.parse(json)
          const sorted = parsed.data.slice().sort((a, b) => a.timestamp - b.timestamp)
          return sorted as unknown as VaultMetric[]
        }

        // Retry transient statuses
        const bodyText = await safeText(res)
        const retryable = res.status === 429 || res.status >= 500
        if (!retryable || attempt > options.retries) {
          throw new Error(`Fluxcore API error ${res.status}${bodyText ? `: ${bodyText}` : ""}`)
        }

        const retryAfter = Number(res.headers.get("retry-after"))
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.round(retryAfter * 1000)
            : options.backoffBaseMs * attempt
        await sleep(waitMs)
      } catch (e: any) {
        lastErr = e?.name === "AbortError" ? new Error(`Request aborted`) : e
        if (attempt > options.retries) break
        await sleep(options.backoffBaseMs * attempt)
      }
    }

    throw (lastErr instanceof Error ? lastErr : new Error(String(lastErr)))
  }

  /* ---------------------------- internal utils ---------------------------- */

  private buildHeaders(userHeaders?: Record<string, string>, userAgent?: string): HeadersInit {
    return {
      accept: "application/json",
      ...(userAgent ? { "user-agent": userAgent } : {}),
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...(userHeaders ?? {}),
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeoutMs)
    const inputSignal = init.signal as AbortSignal | undefined

    // Re-abort our controller if caller's signal aborts
    const onAbort = () => controller.abort()
    if (inputSignal) inputSignal.addEventListener("abort", onAbort, { once: true })

    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(id)
      if (inputSignal) inputSignal.removeEventListener("abort", onAbort)
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ""
  }
}
function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}
