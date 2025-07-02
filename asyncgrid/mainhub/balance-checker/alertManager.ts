
import { TokenBalanceInfo } from "./utils"

/**
 * Alert types for balance changes
 */
export type BalanceAlert =
  | {
      type: "sol"
      previous: number
      current: number
      change: number
    }
  | {
      type: "token"
      mint: string
      previous: number
      current: number
      change: number
    }

/**
 * Manages subscription and emission of balance alerts
 */
export class AlertManager {
  private callback: (alert: BalanceAlert) => void
  private history: BalanceAlert[] = []

  constructor(onAlert: (alert: BalanceAlert) => void) {
    this.callback = onAlert
  }

  /**
   * Emit an alert, record history, and invoke callback
   */
  public emit(alert: BalanceAlert): void {
    this.history.push(alert)
    try {
      this.callback(alert)
    } catch (err) {
      console.error("[AlertManager] Callback error:", err)
    }
    // keep history to latest 100 entries
    if (this.history.length > 100) {
      this.history.shift()
    }
  }

  /**
   * Retrieve alert history
   */
  public getHistory(): BalanceAlert[] {
    return [...this.history]
  }

  /**
   * Clear alert history
   */
  public clearHistory(): void {
    this.history = []
  }
}
