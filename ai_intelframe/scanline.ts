import {
  Connection,
  PublicKey,
  ParsedConfirmedTransaction,
  ConfirmedSignatureInfo,
} from "@solana/web3.js"


export interface ScanlineConfig {
  connection: Connection
  walletPublicKey: PublicKey
  maxSignatures?: number
  lamportsThreshold?: number
  pollingIntervalMs?: number
}

export type TransferAlert = {
  signature: string
  amountLamports: number
  source: string
  destination: string
  slot: number
}

export class Scanline {
  private connection: Connection
  private walletPublicKey: PublicKey
  private maxSignatures: number
  private lamportsThreshold: number
  private pollingIntervalMs: number
  private isActive: boolean = false
  private lastSeenSignature: string | null = null

  constructor(config: ScanlineConfig) {
    this.connection = config.connection
    this.walletPublicKey = config.walletPublicKey
    this.maxSignatures = config.maxSignatures ?? 100
    this.lamportsThreshold = config.lamportsThreshold ?? 1_000_000_000 // 1 SOL
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60_000 // 1 minute
  }

  /**
   * Start the polling process
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.pollLoop()
  }

  /**
   * Stop the polling process
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Main polling loop
   */
  private async pollLoop(): Promise<void> {
    while (this.isActive) {
      try {
        const alerts = await this.scanForLargeTransfers()
        alerts.forEach(alert => this.handleAlert(alert))
      } catch (error) {
        console.error("Scanline error:", error)
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  /**
   * Scan recent transactions and detect large transfers
   */
  private async scanForLargeTransfers(): Promise<TransferAlert[]> {
    const signatures = await this.connection.getConfirmedSignaturesForAddress2(
      this.walletPublicKey,
      { limit: this.maxSignatures }
    )

    const newSignatures = this.filterNewSignatures(signatures)
    const alerts: TransferAlert[] = []

    for (const info of newSignatures) {
      const tx = await this.fetchTransaction(info)
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

  /**
   * Fetch and parse a confirmed transaction
   */
  private async fetchTransaction(
    info: ConfirmedSignatureInfo
  ): Promise<ParsedConfirmedTransaction | null> {
    try {
      return await this.connection.getParsedConfirmedTransaction(info.signature)
    } catch {
      return null
    }
  }

  /**
   * Extract transfer instructions from a parsed transaction
   */
  private extractTransfers(
    tx: ParsedConfirmedTransaction
  ): TransferAlert[] {
    const alerts: TransferAlert[] = []
    const slot = tx.slot
    const signature = tx.transaction.signatures[0]

    const instructions = tx.transaction.message.instructions
    for (const instr of instructions) {
      if ("parsed" in instr && instr.parsed.type === "transfer") {
        const info = instr.parsed.info
        const amountLamports = Number(info.lamports)
        const source = info.source as string
        const destination = info.destination as string

        alerts.push({ signature, amountLamports, source, destination, slot })
      }
    }

    return alerts
  }

  /**
   * Filter out signatures that have already been processed
   */
  private filterNewSignatures(
    signatures: ConfirmedSignatureInfo[]
  ): ConfirmedSignatureInfo[] {
    if (!this.lastSeenSignature) return signatures
    const idx = signatures.findIndex(s => s.signature === this.lastSeenSignature)
    return idx >= 0 ? signatures.slice(0, idx) : signatures
  }

  /**
   * Handle an alert (override or subscribe externally)
   */
  protected handleAlert(alert: TransferAlert): void {
    console.log(
      `⚠️ Alert: Transfer of ${alert.amountLamports} lamports detected from ${alert.source} to ${alert.destination} in slot ${alert.slot} (sig: ${alert.signature})`
    )
  }

  /**
   * Utility delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
