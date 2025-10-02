import {
  Connection,
  PublicKey,
  ConfirmedSignatureInfo,
  ParsedTransactionWithMeta,
  TransactionInstruction,
  Transaction,
  Commitment,
  Signer,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js"
import { createTradeInstruction } from "./dealstreamUtils"

/**
 * Market data provider must use real APIs or on-chain reads
 * No mock data allowed
 */
export interface MarketDataProvider {
  /**
   * Returns mid price for base/quote pair
   */
  getMidPrice(baseMint: PublicKey, quoteMint: PublicKey): Promise<number>

  /**
   * Returns pool snapshot needed to estimate price impact
   * reserves are in raw token units, not adjusted by decimals
   * feeBps is total trading fee in basis points if available
   */
  getPoolSnapshot(baseMint: PublicKey, quoteMint: PublicKey): Promise<{
    reserveBase: bigint
    reserveQuote: bigint
    baseDecimals: number
    quoteDecimals: number
    feeBps?: number
    poolAddress?: string
  }>
}

/**
 * Configuration for Dealstream module
 */
export interface DealstreamConfig {
  connection: Connection
  baseTokenMint: PublicKey
  quoteTokenMint: PublicKey
  walletPublicKey: PublicKey
  marketData: MarketDataProvider
  pollingIntervalMs?: number
  maxSignatures?: number
  priceImpactThresholdPct?: number
  commitment?: Commitment
  /**
   * Optional signer set if this class should submit transactions
   * If omitted, executeTrade will throw to prevent unsafe submission
   */
  signers?: Signer[]
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
  poolAddress?: string
}

/**
 * Dealstream scans on-chain DEX events and executes trades when
 * price impact falls within acceptable bounds
 * Uses only real market data via MarketDataProvider
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
  private isActive = false
  private commitment: Commitment
  private marketData: MarketDataProvider
  private signers?: Signer[]

  constructor(config: DealstreamConfig) {
    this.connection = config.connection
    this.baseTokenMint = config.baseTokenMint
    this.quoteTokenMint = config.quoteTokenMint
    this.walletPublicKey = config.walletPublicKey
    this.marketData = config.marketData
    this.pollingIntervalMs = config.pollingIntervalMs ?? 45_000
    this.maxSignatures = config.maxSignatures ?? 75
    this.priceImpactThresholdPct = config.priceImpactThresholdPct ?? 0.5
    this.commitment = config.commitment ?? "confirmed"
    this.signers = config.signers
  }

  /**
   * Start continuous scanning and potential trade execution
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    void this.scanLoop()
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
        const signatures = await this.connection.getSignaturesForAddress(
          this.baseTokenMint,
          { limit: this.maxSignatures },
          this.commitment
        )
        const newSigs = this.filterNewSignatures(signatures)
        for (const info of newSigs) {
          const tx = await this.connection.getParsedTransaction(
            info.signature,
            { commitment: this.commitment, maxSupportedTransactionVersion: 0 }
          )
          if (!tx) continue
          const opp = await this.detectOpportunity(tx)
          if (opp) {
            await this.executeTrade(opp)
          }
          this.lastSignature = info.signature
        }
      } catch (err) {
        console.error("[Dealstream] scan error", err)
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
   * Uses real pool snapshot to estimate price impact with x*y=k model
   */
  private async detectOpportunity(
    tx: ParsedTransactionWithMeta
  ): Promise<TradeOpportunity | null> {
    const slot = tx.slot
    const sig = tx.transaction.signatures[0]
    const instrs = tx.transaction.message.instructions

    // Scan token transfer instructions related to the base token
    for (const instr of instrs) {
      if ("parsed" in instr && instr.program === "spl-token") {
        const parsed = instr.parsed as any
        if (parsed?.type === "transfer" || parsed?.type === "transferChecked") {
          const info = parsed.info
          const mint =
            parsed.type === "transferChecked" ? new PublicKey(info.mint) : undefined

          // Only proceed if the transfer concerns the base mint
          const isBaseTransfer =
            mint?.equals(this.baseTokenMint) ||
            info?.mint === this.baseTokenMint.toBase58()

          if (!isBaseTransfer) continue

          const amountStr =
            parsed.type === "transferChecked"
              ? info?.tokenAmount?.amount
              : info?.amount

          const decimals =
            parsed.type === "transferChecked"
              ? Number(info?.tokenAmount?.decimals ?? 0)
              : Number(info?.tokenDecimals ?? 0)

          if (!amountStr) continue

          const amountBase = Number(amountStr) / 10 ** decimals
          if (!Number.isFinite(amountBase) || amountBase <= 0) continue

          // Fetch pool snapshot and compute price impact
          const snapshot = await this.marketData.getPoolSnapshot(
            this.baseTokenMint,
            this.quoteTokenMint
          )

          const impact = this.estimatePriceImpactXyk({
            tradeBase: amountBase,
            reserveBase: Number(snapshot.reserveBase) / 10 ** snapshot.baseDecimals,
            reserveQuote:
              Number(snapshot.reserveQuote) / 10 ** snapshot.quoteDecimals,
            feeBps: snapshot.feeBps ?? 0,
          })

          if (impact <= this.priceImpactThresholdPct) {
            const mid = await this.marketData.getMidPrice(
              this.baseTokenMint,
              this.quoteTokenMint
            )
            const amountQuote = amountBase * mid
            return {
              signature: sig,
              slot,
              priceImpactPct: impact,
              amountBase,
              amountQuote,
              poolAddress: snapshot.poolAddress,
            }
          }
        }
      }
    }
    return null
  }

  /**
   * Execute trade based on detected opportunity
   * Requires signers to be provided in constructor
   */
  private async executeTrade(opp: TradeOpportunity): Promise<void> {
    if (!this.signers || this.signers.length === 0) {
      throw new Error(
        "No signers provided for Dealstream executeTrade, refusing to submit transaction"
      )
    }
    try {
      const instruction: TransactionInstruction = createTradeInstruction({
        baseMint: this.baseTokenMint,
        quoteMint: this.quoteTokenMint,
        wallet: this.walletPublicKey,
        amountBase: opp.amountBase,
      })

      const tx = new Transaction().add(instruction)
      tx.feePayer = this.walletPublicKey
      const latest = await this.connection.getLatestBlockhash(this.commitment)
      tx.recentBlockhash = latest.blockhash

      const sig = await this.connection.sendTransaction(tx, this.signers, {
        preflightCommitment: this.commitment,
        skipPreflight: false,
        maxRetries: 3,
      })
      console.log(
        `[Dealstream] executed trade`,
        JSON.stringify({ sig, slot: opp.slot, impactPct: opp.priceImpactPct, pool: opp.poolAddress })
      )
    } catch (err) {
      console.error("[Dealstream] trade execution failed", err)
    }
  }

  /**
   * Estimate price impact in percent using constant product AMM math
   * Applies fee to input amount if feeBps provided
   */
  private estimatePriceImpactXyk(params: {
    tradeBase: number
    reserveBase: number
    reserveQuote: number
    feeBps?: number
  }): number {
    const { tradeBase, reserveBase, reserveQuote, feeBps = 0 } = params
    if (tradeBase <= 0 || reserveBase <= 0 || reserveQuote <= 0) return 100

    const fee = 1 - feeBps / 10_000
    const dxEff = tradeBase * fee

    // x*y=k, output dy = (y * dxEff) / (x + dxEff), mid price p = y/x
    const pMid = reserveQuote / reserveBase
    const dy = (reserveQuote * dxEff) / (reserveBase + dxEff)
    const pExec = dy / tradeBase
    const impact = ((pMid - pExec) / pMid) * 100

    return Math.max(0, Number(impact.toFixed(6)))
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/*
Suggested filenames
- dealstream_scanner.ts
- dealstream_executor.ts
- dealstream_runner.ts
