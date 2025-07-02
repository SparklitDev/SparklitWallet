import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js"
import {
  Token,
  TOKEN_PROGRAM_ID,
  AccountInfo as TokenAccountInfo,
} from "@solana/spl-token"

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
 * Translink handles SOL and SPL token transfers
 */
export class Translink {
  private connection: Connection
  private payer: Keypair
  private pollingIntervalMs: number

  constructor(config: TranslinkConfig) {
    this.connection = config.connection
    this.payer = config.payer
    this.pollingIntervalMs = config.pollingIntervalMs ?? 30_000
  }

  /**
   * Send SOL to a recipient
   */
  public async sendSol(
    to: PublicKey,
    amountLamports: number
  ): Promise<TransferResult> {
    try {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.payer.publicKey,
          toPubkey: to,
          lamports: amountLamports,
        })
      )
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.payer]
      )
      const { slot } = await this.connection.getConfirmedTransaction(signature)!
      return { signature, slot, success: true }
    } catch (err: any) {
      return { signature: "", slot: 0, success: false, error: err.message }
    }
  }

  /**
   * Send an SPL token to a recipient
   */
  public async sendSplToken(
    mintAddress: PublicKey,
    toOwner: PublicKey,
    amountTokens: number,
    decimals: number
  ): Promise<TransferResult> {
    try {
      const mint = new PublicKey(mintAddress)
      const token = new Token(
        this.connection,
        mint,
        TOKEN_PROGRAM_ID,
        this.payer
      )
      const fromAccount = await token.getOrCreateAssociatedAccountInfo(
        this.payer.publicKey
      )
      const toAccount = await token.getOrCreateAssociatedAccountInfo(toOwner)
      const amount = amountTokens * 10 ** decimals

      const tx = new Transaction().add(
        Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          fromAccount.address,
          toAccount.address,
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
      const { slot } = await this.connection.getConfirmedTransaction(signature)!
      return { signature, slot, success: true }
    } catch (err: any) {
      return { signature: "", slot: 0, success: false, error: err.message }
    }
  }

  /**
   * Poll until a signature is confirmed or timeout
   */
  public async waitForConfirmation(
    signature: string,
    timeoutMs: number = 60_000
  ): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const result = await this.connection.getSignatureStatus(signature)
      if (result && result.value?.confirmationStatus === "confirmed") {
        return true
      }
      await this.delay(this.pollingIntervalMs)
    }
    return false
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
