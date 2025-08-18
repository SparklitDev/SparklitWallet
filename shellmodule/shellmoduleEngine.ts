import fetch, { RequestInit } from 'node-fetch'
import { z } from 'zod'
import type { VaultMetric } from '../cryptureVaultTypes'

// zod schema to validate API response
const VaultMetricSchema = z.object({
  timestamp: z.number().int(),
  totalValueLocked: z.number(),
  collateralRatio: z.number(),
  // Extend with other VaultMetric fields if needed
})

const SnapshotsResponseSchema = z.object({
  snapshots: z.array(VaultMetricSchema),
})

export interface ShellmoduleEngineOptions {
  retries?: number      // Number of retries on failure
  timeoutMs?: number    // Per-request timeout
}

export class ShellmoduleEngine {
  private readonly apiUrl: string
  private readonly apiKey: string
  private readonly retries: number
  private readonly timeoutMs: number

  constructor(apiUrl: string, apiKey: string, options: ShellmoduleEngineOptions = {}) {
    this.apiUrl = apiUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.retries = options.retries ?? 2
    this.timeoutMs = options.timeoutMs ?? 8000

    if (this.retries < 0 || !Number.isInteger(this.retries)) {
      throw new RangeError(`"retries" must be a non-negative integer (got ${options.retries})`)
    }

    if (this.timeoutMs <= 0 || !Number.isInteger(this.timeoutMs)) {
      throw new RangeError(`"timeoutMs" must be a positive integer (got ${options.timeoutMs})`)
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Fetch snapshot metrics for a specific contract.
   */
  public async fetchSnapshots(contractAddress: string, limit: number = 50): Promise<VaultMetric[]> {
    if (!contractAddress || typeof contractAddress !== 'string') {
      throw new TypeError("contractAddress must be a non-empty string")
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`limit must be a positive integer (got ${limit})`)
    }

    const url = `${this.apiUrl}/shellmodule/snapshots?address=${encodeURIComponent(contractAddress)}&limit=${limit}`

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
        })

        if (!response.ok) {
          const bodyText = await response.text().catch(() => '')
          throw new Error(`HTTP ${response.status}: ${bodyText || response.statusText}`)
        }

        const json = await response.json()
        const validated = SnapshotsResponseSchema.parse(json)
        return validated.snapshots as VaultMetric[]
      } catch (err: any) {
        lastError = err

        const shouldRetry =
          err.name === 'AbortError' ||
          (typeof err.message === 'string' && /^HTTP 5\d{2}/.test(err.message))

        if (!shouldRetry || attempt === this.retries) break
      }
    }

    throw new Error(`❌ Failed to fetch snapshots after ${this.retries + 1} attempt(s): ${lastError?.message || 'Unknown error'}`)
  }
}
