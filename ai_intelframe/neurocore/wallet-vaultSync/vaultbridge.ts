

import {
  Connection,
  PublicKey,
  AccountInfo,
} from "@solana/web3.js"
import {
  VaultState,
  parseVaultData
} from "./vaultbridgeUtils"

/**
 * Configuration for Vaultbridge module
 */
export interface VaultbridgeConfig {
  connection: Connection
  walletPublicKey: PublicKey
  vaultProgramId: PublicKey
  pollingIntervalMs?: number
  onSync: (state: VaultState) => void
}

export class Vaultbridge {
  private connection: Connection
  private walletPublicKey: PublicKey
  private vaultProgramId: PublicKey
  private pollingIntervalMs: number
  private isActive: boolean = false
  private lastState: VaultState | null = null

  constructor(config: VaultbridgeConfig) {
    this.connection = config.connection
    this.walletPublicKey = config.walletPublicKey
    this.vaultProgramId = config.vaultProgramId
    this.pollingIntervalMs = config.pollingIntervalMs ?? 60000
    this.onSync = config.onSync
  }

  private onSync: (state: VaultState) => void

  /**
   * Start periodic synchronization
   */
  public start(): void {
    if (this.isActive) return
    this.isActive = true
    this.syncLoop()
  }

  /**
   * Stop periodic synchronization
   */
  public stop(): void {
    this.isActive = false
  }

  /**
   * Main loop: fetch vault state and trigger callback on change
   */
  private async syncLoop(): Promise<void> {
    while (this.isActive) {
      try {
        const state = await this.fetchVaultState()
        if (!this.lastState || this.hasChanged(this.lastState, state)) {
          this.lastState = state
          this.onSync(state)
        }
      } catch (error) {
        console.error("[Vaultbridge] sync error:", error)
      }
      await this.delay(this.pollingIntervalMs)
    }
  }

  /**
   * Derive vault account PDA and fetch its state
   */
  private async fetchVaultState(): Promise<VaultState> {
    // Derive PDA for vault account based on wallet
    const [vaultAccountPubkey] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), this.walletPublicKey.toBuffer()],
      this.vaultProgramId
    )
    const accountInfo = await this.connection.getAccountInfo(
      vaultAccountPubkey
    )
    if (!accountInfo) {
      throw new Error("Vault account not found")
    }
    return parseVaultData(accountInfo)
  }

  /**
   * Compare two vault states for differences
   */
  private hasChanged(a: VaultState, b: VaultState): boolean {
    if (a.balance !== b.balance) return true
    if (a.assets.length !== b.assets.length) return true
    for (let i = 0; i < a.assets.length; i++) {
      const ai = a.assets[i]
      const bi = b.assets.find(x => x.mint === ai.mint)
      if (!bi || bi.amount !== ai.amount) {
        return true
      }
    }
    return false
  }

  /**
   * Helper delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
