// File: fluxcoreEngine.ts
import fetch from 'node-fetch'

/**
 * FluxcoreEngine: low-level HTTP client for Fluxcore metrics API
 */
export class FluxcoreEngine {
  private readonly apiBase: string
  private readonly apiKey: string

  constructor(apiBase: string, apiKey: string) {
    this.apiBase = apiBase.replace(/\/+$/, '')
    this.apiKey = apiKey
  }

  /**
   * Fetches raw metric data for a given contract and period
   */
  async fetchMetrics(contractAddress: string, hours: number): Promise<any[]> {
    const url = `${this.apiBase}/fluxcore/metrics?address=${encodeURIComponent(contractAddress)}&hours=${hours}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    })
    if (!res.ok) throw new Error(`Fluxcore API error ${res.status}`)
    return (await res.json()).data
  }
}

// File: fluxcoreAnalysisService.ts
import type { VaultMetric } from '../cryptureVaultTypes'

/**
 * FluxcoreAnalysisService: provides computation on raw metrics
 */
export class FluxcoreAnalysisService {
  /**
   * Calculates moving average of volumes over a window
   */
  calculateVolumeMA(metrics: VaultMetric[], window: number): number[] {
    const result: number[] = []
    for (let i = 0; i < metrics.length; i++) {
      const slice = metrics.slice(Math.max(0, i - window + 1), i + 1)
      const sum = slice.reduce((s, m) => s + m.volume, 0)
      result.push(sum / slice.length)
    }
    return result
  }

  /**
   * Detects significant drops in active address count
   */
  detectAddressDrops(metrics: VaultMetric[], threshold: number): number[] {
    const drops: number[] = []
    for (let i = 1; i < metrics.length; i++) {
      const prev = metrics[i-1].activeAddresses
      const curr = metrics[i].activeAddresses
      if (prev > 0 && ((prev - curr) / prev) * 100 >= threshold) {
        drops.push(metrics[i].timestamp)
      }
    }
    return drops
  }
}

// File: fluxcoreAgent.ts
import { FluxcoreEngine } from './fluxcoreEngine'
import { FluxcoreAnalysisService } from './fluxcoreAnalysisService'
import type { VaultMetric } from '../cryptureVaultTypes'

/**
 * FluxcoreAgent: orchestrates data retrieval and analysis for Fluxcore
 */
export class FluxcoreAgent {
  private engine: FluxcoreEngine
  private analysis: FluxcoreAnalysisService

  constructor(apiBase: string, apiKey: string) {
    this.engine = new FluxcoreEngine(apiBase, apiKey)
    this.analysis = new FluxcoreAnalysisService()
  }

  /**
   * Returns moving average series for the last period
   */
  async getVolumeMovingAverage(
    contractAddress: string,
    periodHours: number,
    windowSize: number
  ): Promise<number[]> {
    const metrics = await this.engine.fetchMetrics(contractAddress, periodHours) as VaultMetric[]
    return this.analysis.calculateVolumeMA(metrics, windowSize)
  }

  /**
   * Returns timestamps of activeAddress drops
   */
  async getAddressDropTimestamps(
    contractAddress: string,
    periodHours: number,
    thresholdPercent: number
  ): Promise<number[]> {
    const metrics = await this.engine.fetchMetrics(contractAddress, periodHours) as VaultMetric[]
    return this.analysis.detectAddressDrops(metrics, thresholdPercent)
  }

  /**
   * Fetches raw data for custom use
   */
  async fetchRawData(contractAddress: string, periodHours: number): Promise<VaultMetric[]> {
    return this.engine.fetchMetrics(contractAddress, periodHours) as Promise<VaultMetric[]>
  }
}
