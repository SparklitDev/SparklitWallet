import fetch from 'node-fetch'
import type { VaultMetric } from '../cryptureVaultTypes'

/**
 * DexlayerAgent: orchestrates fetching and analyzing DEX liquidity and volume metrics
 */
export class DexlayerAgent {
  private readonly apiBase: string
  private readonly apiKey: string

  constructor(apiBase: string, apiKey: string) {
    this.apiBase = apiBase.replace(/\/+$/, '')
    this.apiKey = apiKey
  }

  /**
   * Fetches liquidity and volume metrics for a given liquidity pool
   * @param poolAddress - On-chain address of the DEX pool
   * @param periodHours - Lookback window in hours
   * @returns Promise resolving to an array of VaultMetric-like data points
   */
  async fetchPoolMetrics(
    poolAddress: string,
    periodHours: number
  ): Promise<VaultMetric[]> {
    const url = `${this.apiBase}/dexlayer/pool-metrics?address=${encodeURIComponent(
      poolAddress
    )}&hours=${periodHours}`
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    })
    if (!res.ok) {
      throw new Error(`Dexlayer API error ${res.status}: ${res.statusText}`)
    }
    const json = (await res.json()) as { data: VaultMetric[] }
    return json.data
  }

  /**
   * Calculates average liquidity across the period
   */
  async getAverageLiquidity(
    poolAddress: string,
    periodHours: number
  ): Promise<number> {
    const metrics = await this.fetchPoolMetrics(poolAddress, periodHours)
    if (!metrics.length) return 0
    const sum = metrics.reduce((total, m) => total + m.liquidity, 0)
    return sum / metrics.length
  }

  /**
   * Calculates total volume across the period
   */
  async getTotalVolume(
    poolAddress: string,
    periodHours: number
  ): Promise<number> {
    const metrics = await this.fetchPoolMetrics(poolAddress, periodHours)
    return metrics.reduce((total, m) => total + m.volume, 0)
  }

  /**
   * Fetches raw time-series data for custom analysis
   */
  async fetchRawMetrics(
    poolAddress: string,
    periodHours: number
  ): Promise<VaultMetric[]> {
    return this.fetchPoolMetrics(poolAddress, periodHours)
  }
}
