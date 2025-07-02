import { SolscopeEngine, SolscopeMetric } from './solscopeEngine'

/**
 * SolscopeAgent: handles requests for price, volume, and user activity
 */
export class SolscopeAgent {
  private engine: SolscopeEngine

  constructor(solRpcUrl: string, priceApiUrl: string) {
    this.engine = new SolscopeEngine(solRpcUrl, priceApiUrl)
  }

  /**
   * Get summary metrics aggregated over the last period
   */
  async getSummary(
    mintAddress: string,
    periodHours: number
  ): Promise<{ avgPrice: number; totalVolume: number; peakActivity: number }> {
    const data = await this.engine.fetchMetrics(mintAddress, periodHours)
    const avgPrice = data.reduce((s, d) => s + d.price, 0) / data.length
    const totalVolume = data.reduce((s, d) => s + d.volume24h, 0)
    const peakActivity = Math.max(...data.map(d => d.activeUsers))
    return { avgPrice, totalVolume, peakActivity }
  }

  /**
   * Fetch raw time-series payload for charts or deeper analysis
   */
  async fetchTimeSeries(
    mintAddress: string,
    periodHours: number
  ): Promise<SolscopeMetric[]> {
    return this.engine.fetchMetrics(mintAddress, periodHours)
  }
}
