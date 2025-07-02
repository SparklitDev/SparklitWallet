
import {
  Connection,
  PublicKey,
  ConfirmedSignatureInfo,
  ParsedConfirmedTransaction
} from "@solana/web3.js"
import { decodeTransferInstructions, TransferEvent } from "./watchcoreUtils"

/**
 * Configuration for Watchcore module
 */
export interface WatchcoreConfig {
  connection: Connection
  trackedAccounts: PublicKey[]
  pollingIntervalMs?: number
  maxSignaturesPerAccount?: number
  minLamportsThreshold?: number
}

/**
 * Watchcore monitors multiple accounts for transfer events
 */
export class Watchcore {
  private connection: Connection
  private trackedAccounts: PublicKey[]
  private pollingIntervalMs: number
  private maxSignaturesPerAccount: number
  private minLamportsThreshold: number
  private isActive: boolean = false
  private lastSignatures: Map<string, string> = new Map()

  constructor(config: WatchcoreConfig) {
    this.connection = config.connection
    this.trackedAccounts = config.trackedAccounts
    this.pollingIntervalMs = config.pollingIntervalMs ?? 30_000
    this.maxSignaturesPerAccount = config.maxSignaturesPerAccount ?? 50
    this.minLamportsThreshold = config.minLamportsThreshold ?? 500_000_000 // 0.5 SOL
  }

  /**
   * Start monitoring all configured accounts
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.pollLoop()
  }

  /**
   * Stop monitoring
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Poll loop for all accounts
   */
  private async pollLoop(): Promise<void> {
    while (this.isActive) {
      for (const account of this.trackedAccounts) {
        try {
          const sigs = await this.fetchSignatures(account)
          const newSigs = this.filterNewSignatures(account.toBase58(), sigs)
          for (const info of newSigs) {
            const tx = await this.connection.getParsedConfirmedTransaction(info.signature)
            if (!tx) continue
            const events = decodeTransferInstructions(tx)
            for (const ev of events) {
              if (ev.amount >= this.minLamportsThreshold) {
                this.handleEvent(account, ev)
              }
            }
            this.updateLastSignature(account.toBase58(), info.signature)
          }
        } catch (err) {
          console.error(`[Watchcore] Error polling ${account.toBase58()}:`, err)
        }
      }
      await this.sleep(this.pollingIntervalMs)
    }
  }

  /**
   * Fetch recent signatures for a given account
   */
  private fetchSignatures(
    account: PublicKey
  ): Promise<ConfirmedSignatureInfo[]> {
    return this.connection.getConfirmedSignaturesForAddress2(
      account,
      { limit: this.maxSignaturesPerAccount }
    )
  }

  /**
   * Filter signatures that have already been processed
   */
  private filterNewSignatures(
    key: string,
    signatures: ConfirmedSignatureInfo[]
  ): ConfirmedSignatureInfo[] {
    const last = this.lastSignatures.get(key)
    if (!last) return signatures
    const idx = signatures.findIndex(s => s.signature === last)
    return idx >= 0 ? signatures.slice(0, idx) : signatures
  }

  /**
   * Update the last seen signature for an account
   */
  private updateLastSignature(key: string, signature: string): void {
    this.lastSignatures.set(key, signature)
  }

  /**
   * Default event handler (override as needed)
   */
  protected handleEvent(
    account: PublicKey,
    event: TransferEvent
  ): void {
    console.log(
      `🔍 [Watchcore] Large transfer on ${account.toBase58()}: ${event.amount} lamports from ${event.source} to ${event.destination}`
    )
  }

  /**
   * Pause execution for given milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
