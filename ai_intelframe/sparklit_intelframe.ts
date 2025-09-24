import { Connection, PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js"
import { extractTransferEvents, analyzeVolumeSpikes, Insight } from "./intelframeUtils"

export interface IntelframeConfig {
  connection: Connection
  targetAccounts: PublicKey[]
  pollingIntervalMs?: number
  lookbackSignatures?: number
}

export class Intelframe {
  private connection: Connection
  private targetAccounts: PublicKey[]
  private pollingIntervalMs: number
  private lookbackSignatures: number
  private lastSignatures: Map<string, string> = new Map()
  private isActive = false

  constructor(config: IntelframeConfig) {
    this.connection = config.connection
    this.targetAccounts = config.targetAccounts
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60_000
    this.lookbackSignatures = config.lookbackSignatures ?? 100
  }

  public start(): void {
    if (this.isActive) return
    this.isActive = true
    void this.pollLoop()
  }

  public stop(): void {
    this.isActive = false
  }

  private async pollLoop(): Promise<void> {
    while (this.isActive) {
      for (const account of this.targetAccounts) {
        try {
          const sigs = await this.connection.getSignaturesForAddress(account, {
            limit: this.lookbackSignatures,
          })
          const newSigs = this.filterNew(sigs, account.toBase58())

          const txs = (
            await Promise.all(
              newSigs.map(s => this.connection.getParsedTransaction(s.signature))
            )
          ).filter((tx): tx is ParsedTransactionWithMeta => tx !== null)

          if (txs.length > 0) {
            const events = extractTransferEvents(txs)
            const insights: Insight[] = analyzeVolumeSpikes(events)
            insights.forEach(i => this.handleInsight(account, i))

            // update last signature after processing
            this.lastSignatures.set(account.toBase58(), newSigs[0].signature)
          }
        } catch (err) {
          console.error("[Intelframe] error for", account.toBase58(), err)
        }
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  private filterNew(sigs: { signature: string }[], key: string): { signature: string }[] {
    const last = this.lastSignatures.get(key)
    if (!last) return sigs
    const idx = sigs.findIndex(s => s.signature === last)
    return idx >= 0 ? sigs.slice(0, idx) : sigs
  }

  protected handleInsight(account: PublicKey, insight: Insight): void {
    console.log(`[Insight][${account.toBase58()}] ${insight.type}: ${insight.message}`)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
