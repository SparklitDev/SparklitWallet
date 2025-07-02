import fetch from 'node-fetch'
import type { VaultMetric } from '../cryptureVaultTypes'

/**
 * ShellmoduleEngine: low-level client to fetch on-chain snapshots and contract state
 */
export class ShellmoduleEngine {
  private readonly apiUrl: string
  private readonly apiKey: string

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
  }

  /**
   * Fetches snapshot metrics for a given contract address
   * @param contractAddress - On-chain contract address
   * @param limit - Number of snapshots to retrieve
   */
  async fetchSnapshots(
    contractAddress: string,
    limit: number = 50
  ): Promise<VaultMetric[]> {
    const url = `${this.apiUrl}/shellmodule/snapshots?address=${encodeURIComponent(
      contractAddress
    )}&limit=${limit}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    })
    if (!res.ok) throw new Error(`Shellmodule snapshot fetch failed: ${res.status}`)
    const json = await res.json() as { snapshots: VaultMetric[] }
    return json.snapshots
  }
}
