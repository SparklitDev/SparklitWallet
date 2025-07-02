
import { Connection, PublicKey } from "@solana/web3.js"
import { Market } from "@project-serum/serum"

/**
 * Configuration for OrderBook module
 */
export interface OrderBookConfig {
  connection: Connection
  marketAddress: PublicKey
  programId: PublicKey
}

/**
 * Represents a price level in the orderbook
 */
export interface PriceLevel {
  price: number
  size: number
}

export class OrderBook {
  private market: Market

  constructor(private config: OrderBookConfig) {
    this.market = null as any
  }

  /**
   * Load the Serum market if not loaded
   */
  private async loadMarket(): Promise<void> {
    if (this.market) return
    this.market = await Market.load(
      this.config.connection,
      this.config.marketAddress,
      {},
      this.config.programId
    )
  }

  /**
   * Fetch the current bids and asks
   */
  public async fetchOrderbook(): Promise<{
    bids: PriceLevel[]
    asks: PriceLevel[]
  }> {
    await this.loadMarket()
    const [bids, asks] = await Promise.all([
      this.market.loadBids(this.config.connection),
      this.market.loadAsks(this.config.connection),
    ])
    return {
      bids: this.parseBook(bids),
      asks: this.parseBook(asks),
    }
  }

  /**
   * Parse the raw orderbook into structured levels
   */
  private parseBook(book: any): PriceLevel[] {
    const levels: PriceLevel[] = []
    for (const order of book.getL2(20)) {
      const [price, size] = order
      levels.push({ price, size })
    }
    return levels
  }
}
