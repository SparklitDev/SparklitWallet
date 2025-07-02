

import { Connection, PublicKey } from "@solana/web3.js"
import {
  lamportsToSol,
  formatTokenAccounts,
  TokenBalanceInfo
} from "./syncbalanceUtils"

/**
 * Configuration for Syncbalance module
 */
export interface SyncbalanceConfig {
  connection: Connection
  walletPublicKey: PublicKey
  pollingIntervalMs?: number
  onUpdate: (balances: {
    sol: number
    tokens: TokenBalanceInfo[]
  }) => void
}

/**
 * Syncbalance continuously polls a wallet's SOL and token balances
 * and notifies via callback on each update
 */
export class Syncbalance {
  private connection: Connection
  private walletPublicKey: PublicKey
  private pollingIntervalMs: number
  private onUpdate: SyncbalanceConfig["onUpdate"]
  private isActive = false
  private lastSolBalance: number | null = null
  private lastTokenBalances: Map<string, number> = new Map()

  constructor(config: SyncbalanceConfig) {
    this.connection = config.connection
    this.walletPublicKey = config.walletPublicKey
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60_000
    this.onUpdate = config.onUpdate
  }

  /**
   * Start periodic balance sync
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.pollLoop()
  }

  /**
   * Stop periodic balance sync
   */
  public stop(): void {
    this.isActive = false
  }

  private async pollLoop(): Promise<void> {
    while (this.isActive) {
      try {
        const solLamports = await this.connection.getBalance(this.walletPublicKey)
        const sol = lamportsToSol(solLamports)
        const rawTokenInfo = await this.connection.getParsedTokenAccountsByOwner(
          this.walletPublicKey,
          { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
        )
        const tokens = formatTokenAccounts(rawTokenInfo.value)

        const solChanged = this.lastSolBalance === null || sol !== this.lastSolBalance
        const tokensChanged =
          tokens.length !== this.lastTokenBalances.size ||
          tokens.some(t => this.lastTokenBalances.get(t.mint) !== t.balance)

        if (solChanged || tokensChanged) {
          this.lastSolBalance = sol
          this.lastTokenBalances.clear()
          tokens.forEach(t => this.lastTokenBalances.set(t.mint, t.balance))

          this.onUpdate({ sol, tokens })
        }
      } catch (err) {
        console.error("[Syncbalance] Error fetching balances:", err)
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
