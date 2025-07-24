import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  ConfirmedTransaction,
} from "@solana/web3.js"
import {
  Token,
  TOKEN_PROGRAM_ID,
  AccountInfo as TokenAccountInfo,
} from "@solana/spl-token"
import { EventEmitter } from "events"

/**
 * Configuration for Translink module
 */
export interface TranslinkConfig {
  connection: Connection
  payer: Keypair
  pollingIntervalMs?: number
}

/**
 * Result of a transfer operation
 */
export interface TransferResult {
  signature: string
  slot: number
  success: boolean
  error?: string
}

/**
 * Translink handles SOL and SPL token transfers with events
 */
export class Translink extends EventEmitter {
  private connection: Connection
  private payer: Keypair
  private pollingIntervalMs: number

  constructor(config: TranslinkConfig) {
    super()
    this.connection = config.connection
    this.payer = config.payer
    this.pollingIntervalMs = config.pollingIntervalMs ?? 30_000
  }

  /**
   * Send SOL to a recipient
   * Emits 'transfer' with TransferResult
   */
  public async sendSol(
    to: PublicKey,
    amountLamports: number
  ): Promise<TransferResult> {
    let result: TransferResult = { signature: "", slot: 0, success: false }
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.payer.publicKey,
          toPubkey: to,
          lamports: amountLamports,
        })
      )
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.payer]
      )
      const parsed = await this.fetchConfirmed(signature)
      result = { signature, slot: parsed.slot!, success: true }
    } catch (err: any) {
      result.error = err.message
    }
    this.emit("transfer", result)
    return result
  }

  /**
   * Send an SPL token to a recipient
   * Emits 'transfer' with TransferResult
   */
  public async sendSplToken(
    mintAddress: PublicKey,
    toOwner: PublicKey,
    amountTokens: number,
    decimals: number
  ): Promise<TransferResult> {
    let result: TransferResult = { signature: "", slot: 0, success: false }
    try {
      const token = new Token(
        this.connection,
        mintAddress,
        TOKEN_PROGRAM_ID,
        this.payer
      )
      const fromAcct = await token.getOrCreateAssociatedAccountInfo(
        this.payer.publicKey
      )
      const toAcct = await token.getOrCreateAssociatedAccountInfo(toOwner)
      const amount = BigInt(amountTokens) * BigInt(10 ** decimals)

      const tx = new Transaction().add(
        Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          fromAcct.address,
          toAcct.address,
          this.payer.publicKey,
          [],
          amount
        )
      )
      const signature = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.payer]
      )
      const parsed = await this.fetchConfirmed(signature)
      result = { signature, slot: parsed.slot!, success: true }
    } catch (err: any) {
      result.error = err.message
    }
    this.emit("transfer", result)
    return result
  }

  /**
   * Poll until a signature is confirmed ('confirmed' or 'finalized') or timeout
   */
  public async waitForConfirmation(
    signature: string,
    timeoutMs: number = 60_000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const status = await this.connection.getSignatureStatus(signature)
      const conf = status?.value?.confirmationStatus
      if (conf === "confirmed" || conf === "finalized") {
        return true
      }
      await this.delay(this.pollingIntervalMs)
    }
    return false
  }

  /** Helper: fetch parsed confirmed transaction for slot */
  private async fetchConfirmed(
    signature: string
  ): Promise<ConfirmedTransaction> {
    const tx = await this.connection.getTransaction(signature, {
      commitment: "confirmed",
    })
    if (!tx) throw new Error("Failed to fetch confirmed transaction")
    return tx
  }

  /** Utility delay */
  private delay(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms))
  }
}
