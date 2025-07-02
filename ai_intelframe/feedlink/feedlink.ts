import {
  Connection,
  PublicKey,
  Commitment,
  AccountInfo,
  Context,
} from "@solana/web3.js"

/**
 * Callback signature for account data updates
 */
export type FeedlinkCallback = (address: string, data: Buffer, context: Context) => void

/**
 * FeedlinkConfig defines settings for subscribing to multiple accounts
 */
export interface FeedlinkConfig {
  connection: Connection
  accountKeys: PublicKey[]
  commitment?: Commitment
  callback: FeedlinkCallback
}

/**
 * Feedlink manages real-time subscriptions to Solana account data changes
 */
export class Feedlink {
  private connection: Connection
  private accountKeys: PublicKey[]
  private commitment: Commitment
  private callback: FeedlinkCallback
  private subscriptionIds: number[] = []

  constructor(config: FeedlinkConfig) {
    this.connection = config.connection
    this.accountKeys = config.accountKeys
    this.commitment = config.commitment ?? "confirmed"
    this.callback = config.callback
  }

  /**
   * Start listening to account data updates
   */
  public start(): void {
    this.accountKeys.forEach((key) => {
      const id = this.connection.onAccountChange(
        key,
        (accountInfo: AccountInfo<Buffer>, context: Context) => {
          this.callback(key.toBase58(), accountInfo.data, context)
        },
        this.commitment
      )
      this.subscriptionIds.push(id)
    })
  }

  /**
   * Stop all active subscriptions
   */
  public stop(): void {
    this.subscriptionIds.forEach((id) => {
      this.connection.removeAccountChangeListener(id)
    })
    this.subscriptionIds = []
  }

  /**
   * Add a new account to the subscription list (while running)
   */
  public addAccount(key: PublicKey): void {
    if (this.subscriptionIds.length === 0) {
      // not started yet
      this.accountKeys.push(key)
    } else {
      const id = this.connection.onAccountChange(
        key,
        (accountInfo, context) => {
          this.callback(key.toBase58(), accountInfo.data, context)
        },
        this.commitment
      )
      this.subscriptionIds.push(id)
      this.accountKeys.push(key)
    }
  }

  /**
   * Remove an account subscription by public key
   */
  public removeAccount(key: PublicKey): void {
    const index = this.accountKeys.findIndex((k) => k.equals(key))
    if (index < 0) return

    const subId = this.subscriptionIds[index]
    this.connection.removeAccountChangeListener(subId)

    this.accountKeys.splice(index, 1)
    this.subscriptionIds.splice(index, 1)
  }
}
