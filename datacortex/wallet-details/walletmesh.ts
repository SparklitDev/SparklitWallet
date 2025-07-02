// walletmesh/walletmesh.ts

import { Connection, PublicKey, AccountInfo, ParsedAccountData } from "@solana/web3.js"
import { lamportsToSol, shortenKey, parseTokenAccounts } from "./walletmeshUtils"

/**
 * Configuration for Walletmesh module
 */
export interface WalletmeshConfig {
  connection: Connection
  walletAddress: string
  pollingIntervalMs?: number
  maxHistoryEntries?: number
}

/**
 * A unified interface for fetching wallet details
 */
export class Walletmesh {
  private connection: Connection
  private publicKey: PublicKey
  private pollingIntervalMs: number
  private maxHistoryEntries: number
  private isActive: boolean = false

  constructor(config: WalletmeshConfig) {
    this.connection = config.connection
    this.publicKey = new PublicKey(config.walletAddress)
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60_000
    this.maxHistoryEntries = config.maxHistoryEntries ?? 20
  }

  /**
   * Start periodic updates of wallet info
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.updateLoop()
  }

  /**
   * Stop periodic updates
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Fetch SOL balance
   */
  public async getSolBalance(): Promise<number> {
    const lamports = await this.connection.getBalance(this.publicKey)
    return lamportsToSol(lamports)
  }

  /**
   * Fetch token balances for SPL tokens
   */
  public async getTokenBalances(): Promise<{ mint: string; balance: number }[]> {
    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
      this.publicKey,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    )
    return parseTokenAccounts(tokenAccounts.value)
  }

  /**
   * Fetch recent transaction signatures
   */
  public async getRecentSignatures(): Promise<string[]> {
    const signatures = await this.connection.getConfirmedSignaturesForAddress2(
      this.publicKey,
      { limit: this.maxHistoryEntries }
    )
    return signatures.map(info => info.signature)
  }

  /**
   * Fetch parsed transaction history up to maxHistoryEntries
   */
  public async getTransactionHistory(): Promise<ParsedAccountData[]> {
    const sigs = await this.getRecentSignatures()
    const txs = await Promise.all(
      sigs.map(sig => this.connection.getParsedConfirmedTransaction(sig))
    )
    return txs.filter((tx): tx is ParsedAccountData => tx !== null)
  }

  /**
   * Periodically fetch and log wallet details
   */
  private async updateLoop(): Promise<void> {
    while (this.isActive) {
      try {
        const sol = await this.getSolBalance()
        console.log(`SOL Balance: ${sol.toFixed(4)}`)
        const tokens = await this.getTokenBalances()
        tokens.forEach(t =>
          console.log(`Token ${shortenKey(t.mint)}: ${t.balance}`)
        )
      } catch (err) {
        console.error("[Walletmesh] Error fetching details:", err)
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  /**
   * Utility delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
