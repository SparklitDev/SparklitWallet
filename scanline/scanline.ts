import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
  ConfirmedSignatureInfo,
  Commitment,
  PartiallyDecodedInstruction,
  ParsedInstruction,
} from "@solana/web3.js"
import { EventEmitter } from "events"

/**
 * Scanline module for Sparklit Wallet
 * Monitors recent transactions and emits alerts for large SOL (lamports) transfers
 */
export interface ScanlineConfig {
  connection: Connection
  walletPublicKey: PublicKey
  /** Max signatures to fetch per page (default: 100) */
  maxSignatures?: number
  /** Threshold in lamports to trigger an alert (default: 1 SOL) */
  lamportsThreshold?: number
  /** Poll interval in ms (default: 60_000) */
  pollingIntervalMs?: number
  /** RPC commitment (default: "confirmed") */
  commitment?: Commitment
  /** Concurrency for fetching transactions (default: 5) */
  fetchConcurrency?: number
  /** Pages to scan per poll, for safe backfill if many txs (default: 1) */
  pagesPerPoll?: number
  /**
   * If false, on the very first poll we will set the high-water mark
   * to the latest signature and NOT backfill historical txs (default: false).
   * Set true to process the first page on startup.
   */
  backfillOnStart?: boolean
  /** If true, include transfers where source === destination (default: false) */
  includeSelfTransfers?: boolean
}

export type TransferAlert = {
  signature: string
  amountLamports: number
  source: string
  destination: string
  slot: number
}

type TxInstr = ParsedInstruction | PartiallyDecodedInstruction

export class Scanline extends EventEmitter {
  private readonly connection: Connection
  private readonly walletPublicKey: PublicKey
  private readonly maxSignatures: number
  private readonly lamportsThreshold: number
  private readonly pollingIntervalMs: number
  private readonly commitment: Commitment
  private readonly fetchConcurrency: number
  private readonly pagesPerPoll: number
  private readonly backfillOnStart: boolean
  private readonly includeSelfTransfers: boolean

  private isActive = false
  private lastSeenSignature: string | null = null

  constructor(config: ScanlineConfig) {
    super()
    const {
      connection,
      walletPublicKey,
      maxSignatures = 100,
      lamportsThreshold = 1_000_000_000, // 1 SOL
      pollingIntervalMs = 60_000, // 1 minute
      commitment = "confirmed",
      fetchConcurrency = 5,
      pagesPerPoll = 1,
      backfillOnStart = false,
      includeSelfTransfers = false,
    } = config

    this.connection = connection
    this.walletPublicKey = walletPublicKey
    this.maxSignatures = Math.max(1, Math.min(1000, maxSignatures))
    this.lamportsThreshold = Math.max(0, lamportsThreshold)
    this.pollingIntervalMs = Math.max(250, pollingIntervalMs)
    this.commitment = commitment
    this.fetchConcurrency = Math.max(1, fetchConcurrency)
    this.pagesPerPoll = Math.max(1, pagesPerPoll)
    this.backfillOnStart = backfillOnStart
    this.includeSelfTransfers = includeSelfTransfers
  }

  /** Start polling; emits 'alert' for each TransferAlert and 'error' on failures */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    queueMicrotask(() => this.pollLoop().catch(err => this.emit("error", err)))
    this.emit("started")
  }

  /** Stop polling */
  public stop(): void {
    this.isActive = false
  }

  private async pollLoop(): Promise<void> {
    while (this.isActive) {
      try {
        const alerts = await this.scanForLargeTransfers()
        for (const alert of alerts) this.emit("alert", alert)
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)))
      }
      await this.delay(this.pollingIntervalMs)
    }
    this.emit("stopped")
  }

  private async scanForLargeTransfers(): Promise<TransferAlert[]> {
    const alerts: TransferAlert[] = []
    let before: string | undefined = undefined

    for (let page = 0; page < this.pagesPerPoll; page++) {
      // NOTE: commitment is a separate parameter, NOT inside the options object
      const sigs = await this.connection.getSignaturesForAddress(
        this.walletPublicKey,
        { limit: this.maxSignatures, before },
        this.commitment
      )

      if (!sigs.length) break

      // If first run and we don't want to backfill, just set the watermark and exit
      if (!this.lastSeenSignature && !this.backfillOnStart) {
        this.lastSeenSignature = sigs[0]?.signature ?? null
        break
      }

      const newSigs = this.filterNewSignatures(sigs)
      if (newSigs.length) {
        const pageAlerts = await this.processSignatures(newSigs)
        alerts.push(...pageAlerts)
        // Update high-water mark to the OLDEST processed (tail of newSigs)
        this.lastSeenSignature = newSigs[newSigs.length - 1]!.signature
      }

      // If we already bumped into the high-water mark inside this page, no need to continue
      if (newSigs.length < sigs.length) break

      // Prepare to fetch older page if needed
      before = sigs[sigs.length - 1]!.signature
    }

    return alerts
  }

  private async processSignatures(sigInfos: ConfirmedSignatureInfo[]): Promise<TransferAlert[]> {
    const b58 = this.walletPublicKey.toBase58()
    const results = await mapLimit(sigInfos, this.fetchConcurrency, async (info) => {
      const tx = await this.fetchTransaction(info.signature)
      if (!tx) return [] as TransferAlert[]

      // collect alerts from both top-level and inner instructions
      const sigAlerts: TransferAlert[] = []

      // top-level
      sigAlerts.push(...this.extractTransfersFromInstructions(tx, tx.transaction.message.instructions as TxInstr[]))

      // inner instructions (if parsed)
      const inner = tx.meta?.innerInstructions ?? []
      for (const innerGroup of inner) {
        const ixs = (innerGroup.instructions as any[]).filter(Boolean) as TxInstr[]
        sigAlerts.push(...this.extractTransfersFromInstructions(tx, ixs))
      }

      // filter to only those involving our wallet
      return sigAlerts.filter(a =>
        a.amountLamports >= this.lamportsThreshold &&
        (a.source === b58 || a.destination === b58) &&
        (this.includeSelfTransfers || a.source !== a.destination)
      )
    })

    return results.flat()
  }

  private async fetchTransaction(signature: string): Promise<ParsedTransactionWithMeta | null> {
    try {
      return await this.connection.getParsedTransaction(signature, this.commitment)
    } catch {
      return null
    }
  }

  private extractTransfersFromInstructions(tx: ParsedTransactionWithMeta, instrs: TxInstr[]): TransferAlert[] {
    const alerts: TransferAlert[] = []
    const slot = (tx as any).slot ?? -1 // ParsedTransactionWithMeta includes `slot`
    const signature = tx.transaction.signatures[0]!

    for (const instr of instrs) {
      if (!("parsed" in instr)) continue
      // We care about native SOL transfers (System Program)
      if ((instr as ParsedInstruction).parsed?.type === "transfer" && (instr as ParsedInstruction).program === "system") {
        const info: any = (instr as ParsedInstruction).parsed.info
        const amountLamports = Number(info?.lamports ?? NaN)
        const source = String(info?.source ?? "")
        const destination = String(info?.destination ?? "")
        if (Number.isFinite(amountLamports) && source && destination) {
          alerts.push({ signature, amountLamports, source, destination, slot })
        }
      }
    }

    return alerts
  }

  private filterNewSignatures(signatures: ConfirmedSignatureInfo[]): ConfirmedSignatureInfo[] {
    if (!this.lastSeenSignature) return signatures
    const idx = signatures.findIndex((s) => s.signature === this.lastSeenSignature)
    return idx >= 0 ? signatures.slice(0, idx) : signatures
  }

  /** Utility delay */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/* -------------------- small util: mapLimit -------------------- */

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  let active = 0

  return new Promise<R[]>((resolve, reject) => {
    const runNext = () => {
      if (nextIndex >= items.length && active === 0) return resolve(results)
      while (active < limit && nextIndex < items.length) {
        const i = nextIndex++
        active++
        mapper(items[i]!, i)
          .then((r) => {
            results[i] = r
            active--
            runNext()
          })
          .catch((e) => reject(e))
      }
    }
    runNext()
  })
}
