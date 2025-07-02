
import { Connection, PublicKey, ParsedConfirmedTransaction } from "@solana/web3.js"
import { extractTransferEvents, analyzeVolumeSpikes, Insight } from "./intelframeUtils"

/**
 * Configuration for Intelframe module
 */
export interface IntelframeConfig {
  connection: Connection
  targetAccounts: PublicKey[]
  pollingIntervalMs?: number
  lookbackSignatures?: number
}

/**
 * Intelframe provides AI-driven insights on account activity
 */
export class Intelframe {
  private connection: Connection
  private targetAccounts: PublicKey[]
  private pollingIntervalMs: number
  private lookbackSignatures: number
  private lastSignatures: Map<string, string> = new Map()
  private isActive: boolean = false

  constructor(config: IntelframeConfig) {
    this.connection = config.connection
    this.targetAccounts = config.targetAccounts
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60000
    this.lookbackSignatures = config.lookbackSignatures ?? 100
  }

  /**
   * Start continuous insight generation
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.pollLoop()
  }

  /**
   * Stop insight generation
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Poll loop gathering transactions and producing insights
   */
  private async pollLoop(): Promise<void> {
    while (this.isActive) {
      for (const account of this.targetAccounts) {
        try {
          const sigs = await this.connection.getConfirmedSignaturesForAddress2(
            account,
            { limit: this.lookbackSignatures }
          )
          const newSigs = this.filterNew(sigs, account.toBase58())
          const txs: ParsedConfirmedTransaction[] = []
          for (const info of newSigs) {
            const tx = await this.connection.getParsedConfirmedTransaction(info.signature)
            if (tx) txs.push(tx)
            this.lastSignatures.set(account.toBase58(), info.signature)
          }
          const events = extractTransferEvents(txs)
          const insights: Insight[] = analyzeVolumeSpikes(events)
          insights.forEach(i => this.handleInsight(account, i))
        } catch (err) {
          console.error("[Intelframe] error for", account.toBase58(), err)
        }
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  /**
   * Filter signatures unseen previously
   */
  private filterNew(
    sigs: { signature: string }[],
    key: string
  ): { signature: string }[] {
    const last = this.lastSignatures.get(key)
    if (!last) return sigs
    const idx = sigs.findIndex(s => s.signature === last)
    return idx >= 0 ? sigs.slice(0, idx) : sigs
  }

  /**
   * Default handler for insights (override as needed)
   */
  protected handleInsight(account: PublicKey, insight: Insight): void {
    console.log(
      `[Insight][${account.toBase58()}] ${insight.type}: ${insight.message}`
    )
  }

  /**
   * Utility sleep
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
