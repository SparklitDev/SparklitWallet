// initstack.ts

import { Connection, PublicKey, Commitment } from "@solana/web3.js"
import { Scanline, ScanlineConfig } from "../sparklit/scanline/scanline"
import { Watchcore, WatchcoreConfig } from "../watchcore/watchcore"
import { Watchapi, WatchapiConfig } from "../watchapi/watchapi"

/** Hooks for instrumentation */
export interface InitstackHooks {
  onBeforeStart?: (module: string) => void
  onAfterStart?: (module: string) => void
  onBeforeStop?: (module: string) => void
  onAfterStop?: (module: string) => void
  onError?: (module: string, error: Error) => void
}

/** Configuration for the full stack */
export interface InitstackConfig {
  rpcUrl: string
  scanlineWallet: string
  watchcoreAccounts: string[]
  apiPort?: number
  pollingIntervalMs?: number
  scanlineThresholdLamports?: number
  watchcoreThresholdLamports?: number
  commitment?: Commitment
  hooks?: InitstackHooks
}

/** Simple structured logger */
const logger = {
  info: (msg: string, meta: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), msg, ...meta })),
  warn: (msg: string, meta: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ level: "warn", ts: new Date().toISOString(), msg, ...meta })),
  error: (msg: string, meta: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ level: "error", ts: new Date().toISOString(), msg, ...meta })),
}

/** Runtime module state */
type ModuleState = "idle" | "starting" | "running" | "stopping" | "stopped" | "error"

export class Initstack {
  private readonly connection: Connection
  private readonly scanline: Scanline
  private readonly watchcore: Watchcore
  private readonly watchapi: Watchapi
  private readonly hooks: Required<InitstackHooks>
  private readonly apiPort: number

  private states: Record<"scanline" | "watchcore" | "watchapi", ModuleState> = {
    scanline: "idle",
    watchcore: "idle",
    watchapi: "idle",
  }

  constructor(private cfg: InitstackConfig) {
    // merge hooks with no-ops
    this.hooks = {
      onBeforeStart: cfg.hooks?.onBeforeStart ?? (() => {}),
      onAfterStart: cfg.hooks?.onAfterStart ?? (() => {}),
      onBeforeStop: cfg.hooks?.onBeforeStop ?? (() => {}),
      onAfterStop: cfg.hooks?.onAfterStop ?? (() => {}),
      onError: cfg.hooks?.onError ?? (() => {}),
    }

    // validate required fields
    if (!cfg.rpcUrl) throw new Error("rpcUrl is required")
    if (!cfg.scanlineWallet) throw new Error("scanlineWallet is required")
    if (!cfg.watchcoreAccounts?.length) {
      throw new Error("watchcoreAccounts must include at least one address")
    }

    // defaults
    const commitment: Commitment = cfg.commitment ?? "confirmed"
    const pollingIntervalMs = numberOrDefault(cfg.pollingIntervalMs, 60_000, 1)
    const scanlineThreshold = numberOrDefault(cfg.scanlineThresholdLamports, 1_000_000_000, 0)
    const watchcoreThreshold = numberOrDefault(cfg.watchcoreThresholdLamports, 500_000_000, 0)
    this.apiPort = numberOrDefault(cfg.apiPort, 3000, 1)

    // initialize connection
    this.connection = new Connection(cfg.rpcUrl, commitment)

    // build modules
    try {
      const walletKey = parsePubkeyOrThrow(cfg.scanlineWallet, "scanlineWallet")

      const scanConfig: ScanlineConfig = {
        connection: this.connection,
        walletPublicKey: walletKey,
        lamportsThreshold: scanlineThreshold,
        pollingIntervalMs,
      }
      this.scanline = new Scanline(scanConfig)

      const tracked = unique(
        cfg.watchcoreAccounts.map((addr) => parsePubkeyOrThrow(addr, "watchcoreAccounts"))
      )
      if (tracked.length === 0) {
        throw new Error("No valid watchcoreAccounts after validation")
      }

      const coreConfig: WatchcoreConfig = {
        connection: this.connection,
        trackedAccounts: tracked,
        minLamportsThreshold: watchcoreThreshold,
        pollingIntervalMs,
      }
      this.watchcore = new Watchcore(coreConfig)

      const apiConfig: WatchapiConfig = {
        solanaRpcUrl: cfg.rpcUrl,
        port: this.apiPort,
        pollingIntervalMs,
        maxSignaturesPerAccount: Math.max(50, tracked.length * 50),
        minLamportsThreshold: watchcoreThreshold,
      }
      this.watchapi = new Watchapi(apiConfig)
    } catch (err: any) {
      logger.error("Failed to initialize modules", { error: err?.message ?? String(err) })
      throw err
    }
  }

  /** Initialize and start all modules (idempotent). */
  public async startAll(): Promise<void> {
    // start analytics engines first, then API
    await this.startModule("scanline", () => this.scanline.start())
    await this.startModule("watchcore", () => this.watchcore.start())
    await this.startModule("watchapi", () => this.watchapi.start())
    logger.info("All modules started")
  }

  /** Stop all running modules (idempotent; continues on errors). */
  public async stopAll(): Promise<void> {
    await this.stopModule("watchapi", () => this.watchapi.stop())
    await this.stopModule("watchcore", () => this.watchcore.stop())
    await this.stopModule("scanline", () => this.scanline.stop())
    logger.info("All modules stopped")
  }

  /** Current state snapshot */
  public getStatus(): Record<string, ModuleState> {
    return { ...this.states }
  }

  // ---------- internals ----------

  private async startModule(
    name: "scanline" | "watchcore" | "watchapi",
    action: () => Promise<void>
  ): Promise<void> {
    if (this.states[name] === "running") {
      logger.info(`${name} already running`)
      return
    }
    this.hooks.onBeforeStart(name)
    this.states[name] = "starting"
    const t0 = Date.now()
    try {
      logger.info(`Starting ${name}`, { apiPort: name === "watchapi" ? this.apiPort : undefined })
      await action()
      this.states[name] = "running"
      this.hooks.onAfterStart(name)
      logger.info(`${name} started`, { durationMs: Date.now() - t0 })
    } catch (err: any) {
      this.states[name] = "error"
      logger.error(`Error starting ${name}`, { error: err?.message ?? String(err) })
      this.hooks.onError(name, err)
      throw err
    }
  }

  private async stopModule(
    name: "scanline" | "watchcore" | "watchapi",
    action: () => Promise<void>
  ): Promise<void> {
    if (this.states[name] === "stopped" || this.states[name] === "idle") {
      logger.info(`${name} already stopped`)
      return
    }
    this.hooks.onBeforeStop(name)
    this.states[name] = "stopping"
    const t0 = Date.now()
    try {
      logger.info(`Stopping ${name}`)
      await action()
      this.states[name] = "stopped"
      this.hooks.onAfterStop(name)
      logger.info(`${name} stopped`, { durationMs: Date.now() - t0 })
    } catch (err: any) {
      this.states[name] = "error"
      logger.error(`Error stopping ${name}`, { error: err?.message ?? String(err) })
      this.hooks.onError(name, err)
      // do not rethrow on stop; continue best-effort
    }
  }
}

// ------------------------ helpers ------------------------

function numberOrDefault(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

function parsePubkeyOrThrow(v: string, field: string): PublicKey {
  try {
    return new PublicKey(v)
  } catch {
    throw new Error(`Invalid public key in ${field}: ${v}`)
  }
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.map((x) => JSON.stringify(x)))).map((s) => JSON.parse(s))
}

// ------------------------ bootstrap (optional) ------------------------

async function bootstrap(): Promise<void> {
  const cfg: InitstackConfig = {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    scanlineWallet: (process.env.SCANLINE_WALLET || "").trim(),
    watchcoreAccounts: (process.env.WATCHCORE_ACCOUNTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    apiPort: numberOrDefault(process.env.API_PORT, 3000, 1),
    pollingIntervalMs: numberOrDefault(process.env.POLL_INTERVAL, 60_000, 100),
    scanlineThresholdLamports: numberOrDefault(process.env.SCANLINE_THRESHOLD, 1_000_000_000, 0),
    watchcoreThresholdLamports: numberOrDefault(process.env.WATCHCORE_THRESHOLD, 500_000_000, 0),
    commitment: (["processed", "confirmed", "finalized"] as Commitment[]).includes(
      (process.env.SOLANA_COMMITMENT as Commitment) || ("confirmed" as Commitment)
    )
      ? ((process.env.SOLANA_COMMITMENT as Commitment) || "confirmed")
      : "confirmed",
    hooks: {
      onError: (mod, err) => console.error(`Hook error in ${mod}:`, err),
    },
  }

  if (!cfg.scanlineWallet) {
    logger.warn("SCANLINE_WALLET is empty; startup will fail unless provided")
  }
  if (cfg.watchcoreAccounts.length === 0) {
    logger.warn("WATCHCORE_ACCOUNTS is empty; startup will fail unless provided")
  }

  const stack = new Initstack(cfg)

  // graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown`)
    await stack.stopAll()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  try {
    await stack.startAll()
    logger.info("Initstack is up", { status: stack.getStatus() })
  } catch (err: any) {
    logger.error("Initstack failed to start", { error: err?.message ?? String(err) })
    process.exit(1)
  }
}

if (require.main === module) {
  bootstrap()
}
