// tradeintel/tradeintel.ts

import { Connection, PublicKey, ParsedConfirmedTransaction, ConfirmedSignatureInfo } from "@solana/web3.js"
import { decodeTradeEvents, TradeEvent, aggregateTrades } from "./tradeintelUtils"

/**
 * Configuration for TradeIntel module
 */
export interface TradeIntelConfig {
  connection: Connection
  marketAddresses: PublicKey[]
  pollingIntervalMs?: number
  lookbackSignatures?: number
}

/**
 * Aggregated trade summary
 */
export interface TradeSummary {
  pair: string
  totalVolume: number
  tradeCount: number
  averagePrice: number
}

/**
 * TradeIntel monitors on-chain DEX activity and provides summaries
 */
export class TradeIntel {
  private connection: Connection
  private marketAddresses: PublicKey[]
  private pollingIntervalMs: number
  private lookbackSignatures: number
  private lastSignatureMap: Map<string, string> = new Map()
  private isActive = false

  constructor(config: TradeIntelConfig) {
    this.connection = config.connection
    this.marketAddresses = config.marketAddresses
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60000
    this.lookbackSignatures = config.lookbackSignatures ?? 100
  }

  /**
   * Start monitoring markets for trade data
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.monitorLoop()
  }

  /**
   * Stop monitoring
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Main loop fetching recent transactions, decoding trades, and summarizing
   */
  private async monitorLoop(): Promise<void> {
    while (this.isActive) {
      for (const market of this.marketAddresses) {
        try {
          const sigs = await this.connection.getConfirmedSignaturesForAddress2(
            market,
            { limit: this.lookbackSignatures }
          )
          const newSigs = this.filterNewSignatures(market.toBase58(), sigs)
          const events: TradeEvent[] = []
          for (const info of newSigs) {
            const tx = await this.connection.getParsedConfirmedTransaction(info.signature)
            if (tx) {
              const decoded = decodeTradeEvents(tx)
              events.push(...decoded)
            }
            this.lastSignatureMap.set(market.toBase58(), info.signature)
          }
          if (events.length > 0) {
            const summary = aggregateTrades(events)
            this.handleSummary(market.toBase58(), summary)
          }
        } catch (err) {
          console.error("[TradeIntel] error on market", market.toBase58(), err)
        }
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  /**
   * Filter signatures processed previously
   */
  private filterNewSignatures(key: string, sigs: ConfirmedSignatureInfo[]): ConfirmedSignatureInfo[] {
    const last = this.lastSignatureMap.get(key)
    if (!last) return sigs
    const idx = sigs.findIndex(s => s.signature === last)
    return idx >= 0 ? sigs.slice(0, idx) : sigs
  }

  /**
   * Handle the aggregated summary (override for custom behavior)
   */
  protected handleSummary(marketKey: string, summary: TradeSummary): void {
    console.log(`[TradeIntel][${marketKey}] volume=${summary.totalVolume}, count=${summary.tradeCount}, avgPrice=${summary.averagePrice.toFixed(6)}`)
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
