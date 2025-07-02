
import {
  Connection,
  PublicKey,
  Transaction
} from "@solana/web3.js"
import {
  Market,
  OpenOrders
} from "@project-serum/serum"

/**
 * Configuration for TradeExecutor
 */
export interface TradeExecutorConfig {
  connection: Connection
  marketAddress: PublicKey
  programId: PublicKey
  walletPublicKey: PublicKey
}

/**
 * Supported order sides
 */
export type Side = "buy" | "sell"

export class TradeExecutor {
  private market: Market

  constructor(private config: TradeExecutorConfig) {
    this.market = null as any
  }

  /**
   * Ensure market client is loaded
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
   * Place a limit order on Serum
   * @param side "buy" or "sell"
   * @param price Limit price
   * @param size Base currency size
   */
  public async placeLimitOrder(
    side: Side,
    price: number,
    size: number
  ): Promise<string> {
    await this.loadMarket()
    const owner = this.config.walletPublicKey
    const openOrders = await this.market.findOpenOrdersAccountsForOwner(
      this.config.connection,
      owner
    )
    const transaction = new Transaction()
    const orderParams = {
      owner,
      payer: owner,
      side,
      price,
      size,
      orderType: "limit",
      clientId: undefined,
      openOrdersAddressKey: openOrders.length > 0
        ? openOrders[0].publicKey
        : undefined,
    }
    transaction.add(
      this.market.makePlaceOrderInstruction(this.config.connection, orderParams)
    )
    const signature = await this.config.connection.sendTransaction(
      transaction,
      []
    )
    return signature
  }
}
