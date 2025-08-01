// DexlayerAgent.ts

import fetch, { RequestInit } from 'node-fetch'
import pLimit from 'p-limit'
import { z } from 'zod'
import type { VaultMetric } from '../cryptureVaultTypes'

// Zod schema for a single VaultMetric (adjust fields as needed)
const VaultMetricSchema = z.object({
  timestamp: z.number().int(),
  liquidity: z.number().nonnegative(),
  volume: z.number().nonnegative(),
})

// Zod schema for the API response
const PoolMetricsResponseSchema = z.object({
  data: z.array(VaultMetricSchema),
})

export interface DexlayerAgentOptions {
  /** Number of retry attempts on failure (default: 2) */
  retries?: number
  /** Request timeout in ms (default: 8000) */
  timeoutMs?: number
  /** Concurrency for parallel calls (default: 5) */
  concurrency?: number
}

export class DexlayerAgent {
  private readonly apiBase: string
  private readonly apiKey: string
  private readonly retries: number
  private readonly timeoutMs: number
  private readonly concurrency: number

  constructor(
    apiBase: string,
    apiKey: string,
    opts: DexlayerAgentOptions = {}
  ) {
    if (!apiBase) throw new Error('apiBase is required')
    if (!apiKey) throw new Error('apiKey is required')

    this.apiBase = apiBase.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.retries = opts.retries ?? 2
    this.timeoutMs = opts.timeoutMs ?? 8000
    this.concurrency = opts.concurrency ?? 5

    if (this.retries < 0 || !Number.isInteger(this.retries)) {
      throw new RangeError(`retries must be a non-negative integer, got ${this.retries}`)
    }
    if (this.timeoutMs <= 0 || !Number.isInteger(this.timeoutMs)) {
      throw new RangeError(`timeoutMs must be a positive integer, got ${this.timeoutMs}`)
    }
    if (this.concurrency < 1 || !Number.isInteger(this.concurrency)) {
      throw new RangeError(`concurrency must be >= 1, got ${this.concurrency}`)
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(id)
    }
  }

  /**
   * Fetches pool metrics from the Dexlayer API with retries, timeout, and schema validation.
   */
  public async fetchPoolMetrics(
    poolAddress: string,
    periodHours: number
  ): Promise<VaultMetric[]> {
    if (!poolAddress) throw new Error('poolAddress is required')
    if (!Number.isInteger(periodHours) || periodHours < 1) {
      throw new RangeError(`periodHours must be a positive integer, got ${periodHours}`)
    }

    const url = `${this.apiBase}/dexlayer/pool-metrics?address=${encodeURIComponent(
      poolAddress
    )}&hours=${periodHours}`

    let lastError: any
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchWithTimeout(url, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          throw new Error(`HTTP ${res.status}: ${text}`)
        }
        const json = await res.json()
        const parsed = PoolMetricsResponseSchema.parse(json)
        return parsed.data
      } catch (err: any) {
        lastError = err
        const isServerError = err.message?.startsWith('HTTP') && /^(5\d{2})/.test(err.message)
        if (err.name === 'AbortError' || isServerError) {
          // retry
          continue
        }
        break
      }
    }

    throw new Error(
      `Failed to fetch pool metrics after ${this.retries + 1} attempts: ${lastError.message}`
    )
  }

  /**
   * Calculates average liquidity across the period.
   */
  public async getAverageLiquidity(
    poolAddress: string,
    periodHours: number
  ): Promise<number> {
    const metrics = await this.fetchPoolMetrics(poolAddress, periodHours)
    if (metrics.length === 0) return 0
    const total = metrics.reduce((sum, m) => sum + m.liquidity, 0)
    return total / metrics.length
  }

  /**
   * Calculates total volume across the period.
   */
  public async getTotalVolume(
    poolAddress: string,
    periodHours: number
  ): Promise<number> {
    const metrics = await this.fetchPoolMetrics(poolAddress, periodHours)
    return metrics.reduce((sum, m) => sum + m.volume, 0)
  }

  /**
   * Fetches raw time-series data for custom parallel analysis.
   */
  public async fetchRawMetrics(
    poolAddress: string,
    periodHours: number
  ): Promise<VaultMetric[]> {
    // Optionally you could chunk calls and parallelize with p-limit here
    return this.fetchPoolMetrics(poolAddress, periodHours)
  }
}
