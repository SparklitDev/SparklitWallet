import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
  ConfirmedSignatureInfo,
  Commitment,
} from "@solana/web3.js"
import { EventEmitter } from "events"

/**
 * Scanline module for Sparklit Wallet
 * Monitors recent transactions and emits alerts for large transfers
 */
export interface ScanlineConfig {
  connection: Connection
  walletPublicKey: PublicKey
  maxSignatures?: number
  lamportsThreshold?: number
  pollingIntervalMs?: number
  commitment?: Commitment
}

export type TransferAlert = {
  signature: string
  amountLamports: number
  source: string
  destination: string
  slot: number
}

export class Scanline extends EventEmitter {
  private connection: Connection
  private walletPublicKey: PublicKey
  private maxSignatures: number
  private lamportsThreshold: number
  private pollingIntervalMs: number
  private commitment: Commitment
  private isActive = false
  private lastSeenSignature: string | null = null

  constructor(config: ScanlineConfig) {
    super()
    const {
      connection,
      walletPublicKey,
      maxSignatures = 100,
      lamportsThreshold = 1_000_000_000, // 1 SOL
      pollingIntervalMs = 60_000,        // 1 minute
      commitment = "confirmed",
    } = config

    this.connection = connection
    this.walletPublicKey = walletPublicKey
    this.maxSignatures = maxSignatures
    this.lamportsThreshold = lamportsThreshold
    this.pollingIntervalMs = pollingIntervalMs
    this.commitment = commitment
  }

  /** Start polling; emits 'alert' for each TransferAlert and 'error' on failures */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.pollLoop().catch(err => this.emit("error", err))
  }

  /** Stop polling */
  public stop(): void {
    this.isActive = false
  }

  private async pollLoop(): Promise<void> {
    while (this.isActive) {
      try {
        const alerts = await this.scanForLargeTransfers()
        for (const alert of alerts) {
          this.emit("alert", alert)
        }
      } catch (err) {
        this.emit("error", err)
      }
      await this.delay(this.pollingIntervalMs)
    }
    this.emit("stopped")
  }

  private async scanForLargeTransfers(): Promise<TransferAlert[]> {
    const sigs = await this.connection.getSignaturesForAddress(
      this.walletPublicKey,
      { limit: this.maxSignatures, commitment: this.commitment }
    )

    const newSigs = this.filterNewSignatures(sigs)
    const alerts: TransferAlert[] = []

    for (const info of newSigs) {
      const tx = await this.fetchTransaction(info.signature)
      if (!tx) continue

      const transfers = this.extractTransfers(tx)
      for (const t of transfers) {
        if (t.amountLamports >= this.lamportsThreshold) {
          alerts.push(t)
        }
      }

      this.lastSeenSignature = info.signature
    }

    return alerts
  }

  private async fetchTransaction(
    signature: string
  ): Promise<ParsedTransactionWithMeta | null> {
    try {
      return await this.connection.getParsedTransaction(signature, this.commitment)
    } catch {
      return null
    }
  }

  private extractTransfers(
    tx: ParsedTransactionWithMeta
  ): TransferAlert[] {
    const alerts: TransferAlert[] = []
    const slot = tx.slot ?? -1
    const signature = tx.transaction.signatures[0]!

    for (const instr of tx.transaction.message.instructions) {
      if ("parsed" in instr && instr.parsed.type === "transfer") {
        const info: any = instr.parsed.info
        alerts.push({
          signature,
          amountLamports: Number(info.lamports),
          source: info.source,
          destination: info.destination,
          slot,
        })
      }
    }

    return alerts
  }

  private filterNewSignatures(
    signatures: ConfirmedSignatureInfo[]
  ): ConfirmedSignatureInfo[] {
    if (!this.lastSeenSignature) return signatures
    const idx = signatures.findIndex(s => s.signature === this.lastSeenSignature)
    return idx >= 0 ? signatures.slice(0, idx) : signatures
  }

  /** Utility delay */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
