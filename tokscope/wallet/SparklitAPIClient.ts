import fetch from 'node-fetch'
import type { VaultMetric } from '../cryptureVaultTypes'

/**
 * SparklitAPIClient: handles HTTP interactions with the Sparklit backend
 */
export class SparklitAPIClient {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
  }

  /**
   * Fetches recent vault metrics for a given token
   */
  async fetchVaultMetrics(tokenAddress: string, hours: number): Promise<VaultMetric[]> {
    const url = `${this.baseUrl}/sparklit/metrics?token=${encodeURIComponent(tokenAddress)}&hours=${hours}`
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    })
    if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
    const json = await res.json() as { data: VaultMetric[] }
    return json.data
  }
}

/**
 * SurgeDetectionService: analyzes VaultMetric series for surge patterns
 */
export class SurgeDetectionService {
  private thresholdPercent: number

  constructor(thresholdPercent: number = 10) {
    this.thresholdPercent = thresholdPercent
  }

  /**
   * Returns array of timestamps where volume surge exceeds threshold
   */
  detectVolumeSurges(metrics: VaultMetric[]): number[] {
    const surges: number[] = []
    for (let i = 1; i < metrics.length; i++) {
      const prev = metrics[i-1].volume
      const curr = metrics[i].volume
      if (prev > 0 && ((curr - prev) / prev) * 100 >= this.thresholdPercent) {
        surges.push(metrics[i].timestamp)
      }
    }
    return surges
  }

  /**
   * Returns liquidity dips below threshold percent change
   */
  detectLiquidityDips(metrics: VaultMetric[]): number[] {
    const dips: number[] = []
    for (let i = 1; i < metrics.length; i++) {
      const prev = metrics[i-1].liquidity
      const curr = metrics[i].liquidity
      if (prev > 0 && ((prev - curr) / prev) * 100 >= this.thresholdPercent) {
        dips.push(metrics[i].timestamp)
      }
    }
    return dips
  }
}
