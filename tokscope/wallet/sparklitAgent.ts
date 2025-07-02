import { SparklitAPIClient } from './sparklitServices'
import { SurgeDetectionService } from './sparklitServices'
import type { VaultMetric } from '../cryptureVaultTypes'

/**
 * SparklitAgent: high-level orchestrator for Sparklit project
 *
 * Combines API client and detection service to provide actionable insights
 */
export class SparklitAgent {
  private apiClient: SparklitAPIClient
  private detector: SurgeDetectionService

  constructor(baseUrl: string, apiKey: string, thresholdPercent = 15) {
    this.apiClient = new SparklitAPIClient(baseUrl, apiKey)
    this.detector = new SurgeDetectionService(thresholdPercent)
  }

  /**
   * Retrieves and analyzes vault metrics for surge events
   * @param tokenAddress - SPL token mint address
   * @param periodHours - Lookback window in hours
   * @returns Promise resolving to timestamps of detected surges
   */
  async getVolumeSurges(tokenAddress: string, periodHours: number): Promise<number[]> {
    const metrics: VaultMetric[] = await this.apiClient.fetchVaultMetrics(tokenAddress, periodHours)
    return this.detector.detectVolumeSurges(metrics)
  }

  /**
   * Retrieves and analyzes vault metrics for liquidity dips
   * @param tokenAddress - SPL token mint address
   * @param periodHours - Lookback window in hours
   * @returns Promise resolving to timestamps of detected dips
   */
  async getLiquidityDips(tokenAddress: string, periodHours: number): Promise<number[]> {
    const metrics: VaultMetric[] = await this.apiClient.fetchVaultMetrics(tokenAddress, periodHours)
    return this.detector.detectLiquidityDips(metrics)
  }

  /**
   * Fetches raw metrics for custom analyses
   */
  async fetchRawMetrics(tokenAddress: string, periodHours: number): Promise<VaultMetric[]> {
    return this.apiClient.fetchVaultMetrics(tokenAddress, periodHours)
  }
}
