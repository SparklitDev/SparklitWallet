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
 * Feedlink manages real-time subscriptions to Solana account data changes.
 * Improvements:
 * - Idempotent start/stop
 * - O(1) add/remove via Map (no index mismatch risks)
 * - Duplicate-safe addAccount
 * - Safe callback (exceptions won't crash the subscription loop)
 * - Ability to update callback/commitment at runtime
 * - Query helpers (isRunning, size, list)
 */
export class Feedlink {
  private connection: Connection
  private commitment: Commitment
  private _callback: FeedlinkCallback

  // Track accounts and their subscription ids (when running)
  private entries = new Map<string, { key: PublicKey; subId?: number }>()
  private running = false

  constructor(config: FeedlinkConfig) {
    if (!config?.connection) throw new Error("Feedlink: connection is required")
    if (!config?.callback) throw new Error("Feedlink: callback is required")

    this.connection = config.connection
    this.commitment = config.commitment ?? "confirmed"
    this._callback = config.callback

    for (const k of config.accountKeys ?? []) {
      this.entries.set(k.toBase58(), { key: k })
    }
  }

  /** Replace the callback at runtime */
  public setCallback(cb: FeedlinkCallback): void {
    this._callback = cb
  }

  /** Update commitment; will restart listeners if already running */
  public async setCommitment(commitment: Commitment): Promise<void> {
    if (this.commitment === commitment) return
    this.commitment = commitment
    if (this.running) {
      await this.stop()
      await this.start()
    }
  }

  /** Start listening to account data updates (idempotent) */
  public async start(): Promise<void> {
    if (this.running) return
    this.running = true

    // Attach listeners for all known accounts
    await Promise.all(
      Array.from(this.entries.values()).map(async (e) => {
        e.subId = await this.attach(e.key)
      })
    )
  }

  /** Stop all active subscriptions (idempotent) */
  public async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    const subs = Array.from(this.entries.values())
      .map((e) => e.subId)
      .filter((id): id is number => typeof id === "number")

    // Remove listeners concurrently
    await Promise.all(subs.map((id) => this.connection.removeAccountChangeListener(id).catch(() => {})))

    // Clear subIds but keep the accounts
    for (const e of this.entries.values()) e.subId = undefined
  }

  /** Add a new account to the subscription list (duplicate-safe) */
  public async addAccount(key: PublicKey): Promise<void> {
    const addr = key.toBase58()
    if (this.entries.has(addr)) return // already tracked
    const entry = { key } as { key: PublicKey; subId?: number }
    this.entries.set(addr, entry)

    if (this.running) {
      entry.subId = await this.attach(key)
    }
  }

  /** Remove an account subscription by public key (no-op if absent) */
  public async removeAccount(key: PublicKey): Promise<void> {
    const addr = key.toBase58()
    const entry = this.entries.get(addr)
    if (!entry) return
    if (this.running && typeof entry.subId === "number") {
      await this.connection.removeAccountChangeListener(entry.subId).catch(() => {})
    }
    this.entries.delete(addr)
  }

  /** Number of tracked accounts */
  public size(): number {
    return this.entries.size
  }

  /** Whether subscriptions are active */
  public isRunning(): boolean {
    return this.running
  }

  /** List currently tracked addresses (base58) */
  public list(): string[] {
    return Array.from(this.entries.keys())
  }

  /** Internal: attach a listener for a single account */
  private attach(key: PublicKey): Promise<number> {
    return this.connection.onAccountChange(
      key,
      (accountInfo: AccountInfo<Buffer>, context: Context) => {
        try {
          this._callback(key.toBase58(), accountInfo.data, context)
        } catch (err) {
          // Prevent user callback errors from bubbling into ws loop
          // eslint-disable-next-line no-console
          console.error("[Feedlink] callback error:", err)
        }
      },
      this.commitment
    )
  }
}
