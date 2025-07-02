import { Connection, PublicKey } from "@solana/web3.js"
import { Market } from "@project-serum/serum"

/**
 * A single orderbook level
 */
export interface OrderLevel {
  price: number
  size: number
}

/**
 * Configuration for OrderBook module
 */
export interface OrderBookConfig {
  connection: Connection
  marketAddress: PublicKey
  programId: PublicKey
  depth?: number
}

/**
 * OrderBook fetches and parses Serum orderbook data
 */
export class OrderBook {
  private market: Market | null = null
  private connection: Connection
  private marketAddress: PublicKey
  private programId: PublicKey
  private depth: number

  constructor(config: OrderBookConfig) {
    this.connection = config.connection
    this.marketAddress = config.marketAddress
    this.programId = config.programId
    this.depth = config.depth ?? 20
  }

  /**
   * Ensure market client is loaded
   */
  private async loadMarket(): Promise<void> {
    if (!this.market) {
      this.market = await Market.load(
        this.connection,
        this.marketAddress,
        {},
        this.programId
      )
    }
  }

  /**
   * Fetch bids and asks up to configured depth
   */
  public async fetchOrderbook(): Promise<{
    bids: OrderLevel[]
    asks: OrderLevel[]
  }> {
    await this.loadMarket()
    const [bidsRaw, asksRaw] = await Promise.all([
      this.market!.loadBids(this.connection),
      this.market!.loadAsks(this.connection),
    ])
    return {
      bids: this.parseLevels(bidsRaw.getL2(this.depth)),
      asks: this.parseLevels(asksRaw.getL2(this.depth)),
    }
  }

  /**
   * Convert raw L2 array into structured levels
   */
  private parseLevels(raw: [number, number][]): OrderLevel[] {
    return raw.map(([price, size]) => ({ price, size }))
  }

  /**
   * Calculate mid‐price from top of book
   */
  public async getMidPrice(): Promise<number> {
    const { bids, asks } = await this.fetchOrderbook()
    if (bids.length === 0 || asks.length === 0) {
      throw new Error("Orderbook is empty")
    }
    return (bids[0].price + asks[0].price) / 2
  }
}
