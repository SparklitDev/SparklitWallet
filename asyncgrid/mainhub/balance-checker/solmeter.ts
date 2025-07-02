

import { Connection, PublicKey } from "@solana/web3.js"
import { lamportsToSol, TokenBalanceInfo } from "./utils"
import { AlertManager, BalanceAlert } from "./alertManager"

/**
 * Configuration for Solmeter module
 */
export interface SolmeterConfig {
  connection: Connection
  walletAddress: string
  pollingIntervalMs?: number
  solThresholdChange?: number
  tokenThresholdChange?: number
  onAlert: (alert: BalanceAlert) => void
}

/**
 * Solmeter monitors SOL and SPL token balances and triggers alerts on significant changes
 */
export class Solmeter {
  private connection: Connection
  private publicKey: PublicKey
  private pollingIntervalMs: number
  private solThresholdChange: number
  private tokenThresholdChange: number
  private lastSolBalance: number | null = null
  private lastTokenBalances: Map<string, number> = new Map()
  private alertManager: AlertManager

  constructor(config: SolmeterConfig) {
    this.connection = config.connection
    this.publicKey = new PublicKey(config.walletAddress)
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60_000
    this.solThresholdChange = config.solThresholdChange ?? 0.1
    this.tokenThresholdChange = config.tokenThresholdChange ?? 1
    this.alertManager = new AlertManager(config.onAlert)
  }

  /**
   * Start monitoring balances
   */
  public start(): void {
    this.pollLoop()
  }

  /**
   * Stop monitoring (not implemented for simplicity)
   */
  public stop(): void {
    // no-op
  }

  /**
   * Main polling loop
   */
  private async pollLoop(): Promise<void> {
    while (true) {
      try {
        const lamports = await this.connection.getBalance(this.publicKey)
        const solBalance = lamportsToSol(lamports)
        this.checkSolChange(solBalance)

        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
          this.publicKey,
          { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
        )
        const tokens = tokenAccounts.value.map(acc => {
          const info = acc.account.data.parsed.info
          return { mint: info.mint as string, balance: info.tokenAmount.uiAmount as number }
        })
        this.checkTokenChanges(tokens)
      } catch (error) {
        console.error("[Solmeter] Error polling balances:", error)
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  /**
   * Check for SOL balance change beyond threshold
   */
  private checkSolChange(current: number): void {
    if (this.lastSolBalance === null) {
      this.lastSolBalance = current
      return
    }
    const diff = Math.abs(current - this.lastSolBalance)
    if (diff >= this.solThresholdChange) {
      this.alertManager.emit({
        type: "sol",
        previous: this.lastSolBalance,
        current,
        change: diff
      })
      this.lastSolBalance = current
    }
  }

  /**
   * Check for token balance changes beyond threshold per token
   */
  private checkTokenChanges(currentTokens: TokenBalanceInfo[]): void {
    const currentMap = new Map<string, number>()
    for (const t of currentTokens) {
      currentMap.set(t.mint, t.balance)
      const prev = this.lastTokenBalances.get(t.mint) ?? 0
      const diff = Math.abs(t.balance - prev)
      if (diff >= this.tokenThresholdChange) {
        this.alertManager.emit({
          type: "token",
          mint: t.mint,
          previous: prev,
          current: t.balance,
          change: diff
        })
      }
    }
    this.lastTokenBalances = currentMap
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
