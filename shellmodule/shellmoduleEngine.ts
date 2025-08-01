// ShellmoduleEngine.ts

import fetch, { RequestInit } from 'node-fetch'
import { z } from 'zod'
import type { VaultMetric } from '../cryptureVaultTypes'

// Zod schema for VaultMetric (adjust fields to match your type)
const VaultMetricSchema = z.object({
  timestamp: z.number().int(),
  totalValueLocked: z.number(),
  collateralRatio: z.number(),
  // add other fields from VaultMetric as needed…
})

const SnapshotsResponseSchema = z.object({
  snapshots: z.array(VaultMetricSchema),
})

export interface ShellmoduleEngineOptions {
  /** Number of retry attempts on failure (default: 2) */
  retries?: number
  /** Request timeout in milliseconds (default: 8000) */
  timeoutMs?: number
}

export class ShellmoduleEngine {
  private readonly apiUrl: string
  private readonly apiKey: string
  private readonly retries: number
  private readonly timeoutMs: number

  constructor(
    apiUrl: string,
    apiKey: string,
    opts: ShellmoduleEngineOptions = {}
  ) {
    this.apiUrl = apiUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.retries = opts.retries ?? 2
    this.timeoutMs = opts.timeoutMs ?? 8000

    if (this.retries < 0 || !Number.isInteger(this.retries)) {
      throw new RangeError(`retries must be a non-negative integer, got ${opts.retries}`)
    }
    if (this.timeoutMs <= 0 || !Number.isInteger(this.timeoutMs)) {
      throw new RangeError(`timeoutMs must be a positive integer, got ${opts.timeoutMs}`)
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
   * Fetches snapshot metrics for a given contract address
   * @param contractAddress - On-chain contract address
   * @param limit - Number of snapshots to retrieve
   */
  public async fetchSnapshots(
    contractAddress: string,
    limit: number = 50
  ): Promise<VaultMetric[]> {
    if (typeof contractAddress !== 'string' || !contractAddress) {
      throw new TypeError('contractAddress must be a non-empty string')
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`)
    }

    const url = `${this.apiUrl}/shellmodule/snapshots?address=${encodeURIComponent(
      contractAddress
    )}&limit=${limit}`

    let lastError: any
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchWithTimeout(url, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        })
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          throw new Error(`HTTP ${res.status}: ${text}`)
        }
        const data = await res.json()
        const parsed = SnapshotsResponseSchema.parse(data)
        return parsed.snapshots as VaultMetric[]
      } catch (err: any) {
        lastError = err
        // retry on server errors or timeout
        if (
          err.name === 'AbortError' ||
          (err.message?.startsWith('HTTP') && res?.status >= 500)
        ) {
          continue
        }
        break
      }
    }
    throw new Error(`Failed to fetch snapshots after ${this.retries + 1} attempts: ${lastError.message}`)
  }
}
