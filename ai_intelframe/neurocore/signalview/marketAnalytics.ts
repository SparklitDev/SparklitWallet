import { Connection, ParsedConfirmedTransaction, ConfirmedSignatureInfo, PublicKey } from "@solana/web3.js"

/**
 * Configuration for MarketAnalytics module
 */
export interface MarketAnalyticsConfig {
  connection: Connection
  trackedMints: PublicKey[]
  lookbackSignatures?: number
  pollingIntervalMs?: number
}

/**
 * Represents aggregated volume for a given interval
 */
export interface VolumeSnapshot {
  intervalStart: number
  totalLamports: number
}

/**
 * MarketAnalytics provides insights on SPL token activity
 */
export class MarketAnalytics {
  private connection: Connection
  private trackedMints: PublicKey[]
  private lookbackSignatures: number
  private pollingIntervalMs: number
  private lastSignatures: Map<string, string> = new Map()
  private isActive = false

  constructor(config: MarketAnalyticsConfig) {
    this.connection = config.connection
    this.trackedMints = config.trackedMints
    this.lookbackSignatures = config.lookbackSignatures ?? 100
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60_000
  }

  /**
   * Start periodic analytics loop
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.analyticsLoop()
  }

  /**
   * Stop analytics
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Core loop: fetch recent txs, analyze volumes, and report spikes
   */
  private async analyticsLoop(): Promise<void> {
    while (this.isActive) {
      for (const mint of this.trackedMints) {
        try {
          const sigs = await this.connection.getConfirmedSignaturesForAddress2(
            mint,
            { limit: this.lookbackSignatures }
          )
          const newSigs = this.filterNew(mint.toBase58(), sigs)
          const txs = await Promise.all(
            newSigs.map(info => this.connection.getParsedConfirmedTransaction(info.signature))
          )
          this.lastSignatures.set(mint.toBase58(), newSigs[0]?.signature ?? "")
          const events = this.extractTransferEvents(txs.filter(tx => tx != null) as ParsedConfirmedTransaction[])
          const snapshots = this.computeVolumeSnapshots(events)
          this.detectAndHandleSpikes(mint.toBase58(), snapshots)
        } catch (err) {
          console.error(`[MarketAnalytics] Error for ${mint.toBase58()}:`, err)
        }
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  /**
   * Filter out already‐seen signatures for a mint
   */
  private filterNew(key: string, sigs: ConfirmedSignatureInfo[]): ConfirmedSignatureInfo[] {
    const last = this.lastSignatures.get(key)
    if (!last) return sigs
    const idx = sigs.findIndex(s => s.signature === last)
    return idx >= 0 ? sigs.slice(0, idx) : sigs
  }

  /**
   * Extract transfer events from parsed transactions
   */
  private extractTransferEvents(txs: ParsedConfirmedTransaction[]) {
    const events: { lamports: number; timestamp: number }[] = []
    for (const tx of txs) {
      const time = tx.blockTime ?? 0
      for (const instr of tx.transaction.message.instructions) {
        if ("parsed" in instr && instr.parsed.type === "transfer") {
          const amt = Number(instr.parsed.info.lamports)
          events.push({ lamports: amt, timestamp: time })
        }
      }
    }
    return events
  }

  /**
   * Group events into minute‐based snapshots
   */
  private computeVolumeSnapshots(events: { lamports: number; timestamp: number }[]): VolumeSnapshot[] {
    const buckets: Record<number, number> = {}
    events.forEach(e => {
      const minute = Math.floor(e.timestamp / 60)
      buckets[minute] = (buckets[minute] || 0) + e.lamports
    })
    return Object.entries(buckets)
      .map(([k, v]) => ({ intervalStart: Number(k) * 60, totalLamports: v }))
      .sort((a, b) => a.intervalStart - b.intervalStart)
  }

  /**
   * Detect volume spikes (≥2× growth) and log them
   */
  private detectAndHandleSpikes(key: string, snaps: VolumeSnapshot[]): void {
    for (let i = 1; i < snaps.length; i++) {
      const prev = snaps[i - 1].totalLamports
      const curr = snaps[i].totalLamports
      if (prev > 0 && curr / prev >= 2) {
        console.log(
          `[MarketAnalytics][${key}] Volume spike: ${prev} → ${curr} lamports at ${new Date(
            snaps[i].intervalStart * 1000
          ).toISOString()}`
        )
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
