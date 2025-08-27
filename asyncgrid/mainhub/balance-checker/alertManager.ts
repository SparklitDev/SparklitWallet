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

/** Internal alert shape with metadata */
export type BalanceAlertMeta = BalanceAlert & {
  timestamp: number
}

/** Options to control alert emission & history */
export interface AlertManagerOptions {
  /** Max number of alerts to retain in history (default 200) */
  maxHistory?: number
  /** Ignore alerts whose absolute change is below this (applies to both SOL and tokens) */
  minAbsChange?: number
  /** Ignore alerts below this percent change (0–100); computed as |Δ| / max(ε, prev) * 100 */
  minPctChange?: number
  /** Deduplicate identical alerts for the same key within N ms (default 0 = disabled) */
  dedupeWithinMs?: number
}

/** Listener function */
export type AlertListener = (alert: BalanceAlertMeta) => void

/**
 * Manages subscription and emission of balance alerts
 * Improvements:
 * - Multiple listeners with subscribe()/unsubscribe()
 * - Timestamps and metadata on each alert
 * - Configurable history size & filters (abs / pct thresholds)
 * - Burst deduplication window to avoid spam
 * - Batch emit + utilities (getLast, getStats, clearOlderThan)
 */
export class AlertManager {
  private listeners = new Set<AlertListener>()
  private history: BalanceAlertMeta[] = []
  private readonly maxHistory: number
  private readonly minAbsChange: number
  private readonly minPctChange: number
  private readonly dedupeWithinMs: number

  // Track last emitted per logical key for dedupe
  private lastEmittedAt = new Map<string, number>()
  private lastEmittedVal = new Map<string, string>() // serialize alert for equivalence

  constructor(onAlert?: AlertListener, opts: AlertManagerOptions = {}) {
    this.maxHistory = Math.max(1, Math.floor(opts.maxHistory ?? 200))
    this.minAbsChange = Math.max(0, opts.minAbsChange ?? 0)
    this.minPctChange = Math.max(0, opts.minPctChange ?? 0)
    this.dedupeWithinMs = Math.max(0, opts.dedupeWithinMs ?? 0)

    if (onAlert) this.listeners.add(onAlert)
  }

  /** Subscribe to alerts; returns an unsubscribe function */
  public subscribe(fn: AlertListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Unsubscribe a listener (no-op if not present) */
  public unsubscribe(fn: AlertListener): void {
    this.listeners.delete(fn)
  }

  /** Emit an alert, record history, and notify listeners (with filtering/dedupe) */
  public emit(alert: BalanceAlert): void {
    const ts = Date.now()
    if (!this.shouldEmit(alert)) return

    const key = alert.type === "sol" ? "sol" : `token:${alert.mint}`
    const serialized = JSON.stringify(alert)

    // time-window dedupe
    const prevTs = this.lastEmittedAt.get(key)
    const prevSer = this.lastEmittedVal.get(key)
    if (
      this.dedupeWithinMs > 0 &&
      prevTs !== undefined &&
      ts - prevTs < this.dedupeWithinMs &&
      prevSer === serialized
    ) {
      return
    }

    const meta: BalanceAlertMeta = { ...alert, timestamp: ts }
    this.history.push(meta)
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory)
    }

    // Notify listeners safely
    for (const cb of this.listeners) {
      try {
        cb(meta)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[AlertManager] Listener error:", err)
      }
    }

    this.lastEmittedAt.set(key, ts)
    this.lastEmittedVal.set(key, serialized)
  }

  /** Emit multiple alerts efficiently (applies same filters/dedupe) */
  public emitBatch(alerts: BalanceAlert[]): void {
    for (const a of alerts) this.emit(a)
  }

  /** Retrieve alert history (newest last) */
  public getHistory(): BalanceAlertMeta[] {
    return [...this.history]
  }

  /** Last alert emitted, if any */
  public getLast(): BalanceAlertMeta | undefined {
    return this.history[this.history.length - 1]
  }

  /** Clear alert history */
  public clearHistory(): void {
    this.history = []
  }

  /** Remove alerts older than `ageMs` */
  public clearOlderThan(ageMs: number): void {
    const cutoff = Date.now() - Math.max(0, ageMs)
    this.history = this.history.filter(a => a.timestamp >= cutoff)
  }

  /** Basic stats */
  public getStats(): { total: number; sol: number; tokens: number } {
    let sol = 0
    let tokens = 0
    for (const a of this.history) {
      if (a.type === "sol") sol++
      else tokens++
    }
    return { total: this.history.length, sol, tokens }
  }

  /* ---------------- internal ---------------- */

  private shouldEmit(a: BalanceAlert): boolean {
    // Ignore zero change
    if (!Number.isFinite(a.change) || Math.abs(a.change) <= 0) return false

    // Absolute threshold
    if (Math.abs(a.change) < this.minAbsChange) return false

    // Percent threshold
    const prev = Math.abs(a.previous)
    const denom = prev > 0 ? prev : 1e-9
    const pct = (Math.abs(a.change) / denom) * 100
    if (pct < this.minPctChange) return false

    return true
  }
}
