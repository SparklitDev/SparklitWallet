import { Connection, PublicKey } from '@solana/web3.js'
import fetch from 'node-fetch'

export interface SolscopeMetric {
  timestamp: number       // ms since epoch
  price: number           // token price in USD
  volume24h: number       // 24 h trading volume
  activeUsers: number     // distinct addresses interacting
}

/**
 * SolscopeEngine: fetches price, volume, and activity data
 * from both on-chain RPC and external price APIs
 */
export class SolscopeEngine {
  private rpc: Connection
  private priceApiUrl: string

  constructor(solRpcUrl: string, priceApiUrl: string) {
    this.rpc = new Connection(solRpcUrl, 'confirmed')
    this.priceApiUrl = priceApiUrl.replace(/\/+$/, '')
  }

  /** 
   * Fetch recent block time for Solana (ms) 
   */
  async getCurrentTimestamp(): Promise<number> {
    const slot = await this.rpc.getSlot('finalized')
    const blockTime = await this.rpc.getBlockTime(slot)
    return (blockTime ?? Math.floor(Date.now() / 1000)) * 1000
  }

  /**
   * Fetches historic price snapshots from external API
   */
  async fetchPriceHistory(
    mintAddress: string,
    hours: number
  ): Promise<Array<{ timestamp: number; price: number }>> {
    const url = `${this.priceApiUrl}/price-history?mint=${encodeURIComponent(
      mintAddress
    )}&hours=${hours}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Price API error ${res.status}`)
    return (await res.json()) as Array<{ timestamp: number; price: number }>
  }

  /**
   * Combines on-chain and off-chain data into SolscopeMetric[]
   */
  async fetchMetrics(
    mintAddress: string,
    hours: number
  ): Promise<SolscopeMetric[]> {
    const now = await this.getCurrentTimestamp()
    const priceSeries = await this.fetchPriceHistory(mintAddress, hours)
    // For demo: simulate volume & activeUsers via RPC logs count
    const startSlot = await this.rpc.getSlot('finalized') - hours * 1200
    const logs = await this.rpc.getSignaturesForAddress(new PublicKey(mintAddress), { commitment: 'confirmed', limit: 1000 })
    const activityCount = logs.length

    return priceSeries.map((p, i) => ({
      timestamp: p.timestamp,
      price: p.price,
      volume24h: Math.random() * 1e6,       // replace with real charting API
      activeUsers: Math.floor(activityCount / priceSeries.length)
    }))
  }
}
