import {
  Connection,
  PublicKey,
  ConfirmedSignatureInfo,
  ParsedConfirmedTransaction,
  TransactionInstruction,
} from "@solana/web3.js"
import { createTradeInstruction } from "./dealstreamUtils"

/**
 * Configuration for Dealstream module
 */
export interface DealstreamConfig {
  connection: Connection
  baseTokenMint: PublicKey
  quoteTokenMint: PublicKey
  walletPublicKey: PublicKey
  pollingIntervalMs?: number
  maxSignatures?: number
  priceImpactThresholdPct?: number
}

/**
 * Represents a detected trading opportunity
 */
export interface TradeOpportunity {
  signature: string
  slot: number
  priceImpactPct: number
  amountBase: number
  amountQuote: number
}

/**
 * Dealstream scans on-chain DEX events and executes trades when
 * price impact falls within acceptable bounds
 */
export class Dealstream {
  private connection: Connection
  private baseTokenMint: PublicKey
  private quoteTokenMint: PublicKey
  private walletPublicKey: PublicKey
  private pollingIntervalMs: number
  private maxSignatures: number
  private priceImpactThresholdPct: number
  private lastSignature: string | null = null
  private isActive: boolean = false

  constructor(config: DealstreamConfig) {
    this.connection = config.connection
    this.baseTokenMint = config.baseTokenMint
    this.quoteTokenMint = config.quoteTokenMint
    this.walletPublicKey = config.walletPublicKey
    this.pollingIntervalMs = config.pollingIntervalMs ?? 45_000
    this.maxSignatures = config.maxSignatures ?? 75
    this.priceImpactThresholdPct = config.priceImpactThresholdPct ?? 0.5
  }

  /**
   * Start continuous scanning and potential trade execution
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.scanLoop()
  }

  /**
   * Stop the scanning loop
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Main loop: fetch recent swaps, detect opportunities, execute trades
   */
  private async scanLoop(): Promise<void> {
    while (this.isActive) {
      try {
        const signatures = await this.connection.getConfirmedSignaturesForAddress2(
          this.baseTokenMint,
          { limit: this.maxSignatures }
        )
        const newSigs = this.filterNewSignatures(signatures)
        for (const info of newSigs) {
          const tx = await this.connection.getParsedConfirmedTransaction(info.signature)
          if (!tx) continue
          const opp = this.detectOpportunity(tx)
          if (opp) {
            await this.executeTrade(opp)
          }
          this.lastSignature = info.signature
        }
      } catch (err) {
        console.error("[Dealstream] scan error:", err)
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  /**
   * Filter out already processed signatures
   */
  private filterNewSignatures(
    sigs: ConfirmedSignatureInfo[]
  ): ConfirmedSignatureInfo[] {
    if (!this.lastSignature) return sigs
    const idx = sigs.findIndex(s => s.signature === this.lastSignature)
    return idx >= 0 ? sigs.slice(0, idx) : sigs
  }

  /**
   * Detect if a transaction contains a favorable trade opportunity
   */
  private detectOpportunity(
    tx: ParsedConfirmedTransaction
  ): TradeOpportunity | null {
    const slot = tx.slot
    const sig = tx.transaction.signatures[0]
    // inspect instructions for DEX swap matching base/quote pair
    const instrs = tx.transaction.message.instructions
    for (const instr of instrs) {
      if ("parsed" in instr && instr.program === "spl-token") {
        const parsed = instr.parsed
        if (parsed.type === "transfer") {
          const info = parsed.info
          const amountBase = Number(info.amount) / 10 ** parsed.info.tokenDecimals
          // placeholder: compute priceImpactPct via utility (orderbook snapshot vs trade size)
          const priceImpactPct = this.estimatePriceImpact(amountBase)
          if (priceImpactPct <= this.priceImpactThresholdPct) {
            const amountQuote = amountBase * this.mockMarketRate()
            return { signature: sig, slot, priceImpactPct, amountBase, amountQuote }
          }
        }
      }
    }
    return null
  }

  /**
   * Execute trade based on detected opportunity
   */
  private async executeTrade(opp: TradeOpportunity): Promise<void> {
    try {
      const instruction: TransactionInstruction = createTradeInstruction({
        baseMint: this.baseTokenMint,
        quoteMint: this.quoteTokenMint,
        wallet: this.walletPublicKey,
        amountBase: opp.amountBase,
      })
      const tx = await this.connection.sendTransaction(
        new Transaction().add(instruction),
        []
      )
      console.log(`[Dealstream] executed trade tx sig: ${tx}`)
    } catch (err) {
      console.error("[Dealstream] trade execution failed:", err)
    }
  }

  /**
   * Estimate price impact based on trade size (replace with real logic)
   */
  private estimatePriceImpact(amountBase: number): number {
    // simplistic impact: larger trades => higher impact
    return (Math.log10(amountBase + 1) / 10) * 100
  }

  /**
   * Mock market rate for base->quote conversion (replace with oracle)
   */
  private mockMarketRate(): number {
    // deterministic rate based on timestamp
    const hour = new Date().getUTCHours()
    return 1 + hour / 1000
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
