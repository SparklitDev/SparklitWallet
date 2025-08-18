import { SparklitAPIClient, SurgeDetectionService } from './sparklitServices'
import type { VaultMetric } from '../cryptureVaultTypes'

/**
 * Orchestrator for fetching and analyzing vault data for a given token.
 */
export class SparklitAgent {
  private readonly apiClient: SparklitAPIClient
  private readonly detector: SurgeDetectionService

  constructor(
    baseUrl: string,
    apiKey: string,
    thresholdPercent: number = 15
  ) {
    if (!baseUrl || !apiKey) {
      throw new Error("SparklitAgent requires a base URL and API key.")
    }

    if (thresholdPercent < 1 || thresholdPercent > 100) {
      throw new RangeError("thresholdPercent must be between 1 and 100")
    }

    this.apiClient = new SparklitAPIClient(baseUrl, apiKey)
    this.detector = new SurgeDetectionService(thresholdPercent)
  }

  /**
   * Detects significant surges in vault volume for a token
   */
  async getVolumeSurges(tokenAddress: string, periodHours: number): Promise<number[]> {
    const metrics = await this.fetchValidatedMetrics(tokenAddress, periodHours)
    return this.detector.detectVolumeSurges(metrics)
  }

  /**
   * Detects significant dips in liquidity for a token
   */
  async getLiquidityDips(tokenAddress: string, periodHours: number): Promise<number[]> {
    const metrics = await this.fetchValidatedMetrics(tokenAddress, periodHours)
    return this.detector.detectLiquidityDips(metrics)
  }

  /**
   * Exposes raw metrics for external analytics
   */
  async fetchRawMetrics(tokenAddress: string, periodHours: number): Promise<VaultMetric[]> {
    return this.fetchValidatedMetrics(tokenAddress, periodHours)
  }

  /**
   * Allows metric-based surge analysis (e.g., TVL, collateral ratio)
   */
  async analyzeSurgesByMetric(
    tokenAddress: string,
    periodHours: number,
    metricKey: keyof VaultMetric
  ): Promise<number[]> {
    const metrics = await this.fetchValidatedMetrics(tokenAddress, periodHours)
    return this.detector.detectSurgeOnMetric(metrics, metricKey)
  }

  /**
   * Internal helper to fetch and validate inputs
   */
  private async fetchValidatedMetrics(
    tokenAddress: string,
    periodHours: number
  ): Promise<VaultMetric[]> {
    if (!tokenAddress || typeof tokenAddress !== 'string') {
      throw new TypeError("tokenAddress mu
