

import { Connection, PublicKey } from "@solana/web3.js"
import { Market, Orderbook } from "@project-serum/serum"
import { OrderBook } from "./orderBook"
import { TradeExecutor } from "./tradeExecutor"
import { calculateMidPrice } from "./utils"

/**
 * Configuration for Xhub core
 */
export interface XhubConfig {
  connection: Connection
  marketAddress: PublicKey
  programId: PublicKey
  walletPublicKey: PublicKey
  pollingIntervalMs?: number
}

/**
 * Xhub orchestrates market data fetching and trade execution
 */
export class Xhub {
  private connection: Connection
  private marketAddress: PublicKey
  private programId: PublicKey
  private walletPublicKey: PublicKey
  private pollingIntervalMs: number
  private isActive: boolean = false
  private orderBook: OrderBook
  private executor: TradeExecutor

  constructor(config: XhubConfig) {
    this.connection = config.connection
    this.marketAddress = config.marketAddress
    this.programId = config.programId
    this.walletPublicKey = config.walletPublicKey
    this.pollingIntervalMs = config.pollingIntervalMs ?? 30_000
    this.orderBook = new OrderBook({
      connection: this.connection,
      marketAddress: this.marketAddress,
      programId: this.programId,
    })
    this.executor = new TradeExecutor({
      connection: this.connection,
      marketAddress: this.marketAddress,
      programId: this.programId,
      walletPublicKey: this.walletPublicKey,
    })
  }

  /**
   * Start the monitoring and trading loop
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.loop()
  }

  /**
   * Stop the Xhub core
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Main loop: fetch mid price, decide, and execute trades
   */
  private async loop(): Promise<void> {
    while (this.isActive) {
      try {
        const { bids, asks } = await this.orderBook.fetchOrderbook()
        if (bids.length === 0 || asks.length === 0) {
          console.warn("Empty orderbook, skipping iteration")
        } else {
          const midPrice = calculateMidPrice(bids[0].price, asks[0].price)
          // example strategy: simple mezzanine trade around midPrice
          await this.executor.placeLimitOrder("buy", midPrice * 0.995, 1)
          await this.executor.placeLimitOrder("sell", midPrice * 1.005, 1)
        }
      } catch (err) {
        console.error("[Xhub] Error in loop:", err)
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
