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
  onStateChange?: (module: string, prev: ModuleState, next: ModuleState) => void
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
  /**
   * number of start retries per module
   */
  startRetries?: number
  /**
   * milliseconds between retries
   */
  startRetryDelayMs?: number
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

/** Result helper without throwing */
type Result<T> = { ok: true; value: T } | { ok: false; error: Error }

/** State record for uptime and last transition */
interface ModuleRuntime {
  state: ModuleState
  startedAt: number | null
  lastChange: number
}

export class Initstack {
  private readonly connection: Connection
  private readonly scanline: Scanline
  private readonly watchcore: Watchcore
  private readonly watchapi: Watchapi
  private readonly hooks: Required<InitstackHooks>
  private readonly apiPort: number

  private readonly startRetries: number
  private readonly startRetryDelayMs: number

  private states: Record<"scanline" | "watchcore" | "watchapi", ModuleRuntime> = {
    scanline: { state: "idle", startedAt: null, lastChange: Date.now() },
    watchcore: { state: "idle", startedAt: null, lastChange: Date.now() },
    watchapi: { state: "idle", startedAt: null, lastChange: Date.now() },
  }

  constructor(private cfg: InitstackConfig) {
    // merge hooks with no ops
    this.hooks = {
      onBeforeStart: cfg.hooks?.onBeforeStart ?? (() => {}),
      onAfterStart: cfg.hooks?.onAfterStart ?? (() => {}),
      onBeforeStop: cfg.hooks?.onBeforeStop ?? (() => {}),
      onAfterStop: cfg.hooks?.onAfterStop ?? (() => {}),
      onError: cfg.hooks?.onError ?? (() => {}),
      onStateChange: cfg.hooks?.onStateChange ?? (() => {}),
    }

    // validate required fields
    validateConfig(cfg)

    // defaults
    const commitment: Commitment = cfg.commitment ?? "confirmed"
    const pollingIntervalMs = numberOrDefault(cfg.pollingIntervalMs, 60_000, 1)
    const scanlineThreshold = numberOrDefault(cfg.scanlineThresholdLamports, 1_000_000_000, 0)
    const watchcoreThreshold = numberOrDefault(cfg.watchcoreThresholdLamports, 500_000_000, 0)
    this.apiPort = numberOrDefault(cfg.apiPort, 3000, 1)
    this.startRetries = numberOrDefault(cfg.startRetries, 2, 0)
    this.startRetryDelayMs = numberOrDefault(cfg.startRetryDelayMs, 2_000, 0)

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

  /** Initialize and start all modules in order */
  public async startAll(): Promise<void> {
    // start analytics engines first, then API
    await this.startModuleWithRetry("scanline", () => this.scanline.start())
    await this.startModuleWithRetry("watchcore", () => this.watchcore.start())
    await this.startModuleWithRetry("watchapi", () => this.watchapi.start())
    logger.info("All modules started")
  }

  /** Stop all running modules in reverse order */
  public async stopAll(): Promise<void> {
    await this.stopModule("watchapi", () => this.watchapi.stop())
    await this.stopModule("watchcore", () => this.watchcore.stop())
    await this.stopModule("scanline", () => this.scanline.stop())
    logger.info("All modules stopped")
  }

  /** Start a single module by name */
  public async start(name: "scanline" | "watchcore" | "watchapi"): Promise<void> {
    if (name === "scanline") return this.startModuleWithRetry("scanline", () => this.scanline.start())
    if (name === "watchcore") return this.startModuleWithRetry("watchcore", () => this.watchcore.start())
    return this.startModuleWithRetry("watchapi", () => this.watchapi.start())
  }

  /** Stop a single module by name */
  public async stop(name: "scanline" | "watchcore" | "watchapi"): Promise<void> {
    if (name === "scanline") return this.stopModule("scanline", () => this.scanline.stop())
    if (name === "watchcore") return this.stopModule("watchcore", () => this.watchcore.stop())
    return this.stopModule("watchapi", () => this.watchapi.stop())
  }

  /** Current state snapshot with uptime in milliseconds */
  public getStatus(): Record<string, { state: ModuleState; uptimeMs: number }> {
    return mapValues(this.states, (rt) => ({
      state: rt.state,
      uptimeMs: rt.startedAt ? Date.now() - rt.startedAt : 0,
    }))
  }

  /** Health view for simple checks */
  public getHealth(): Record<string, boolean> {
    return {
      scanline: this.states.scanline.state === "running",
      watchcore: this.states.watchcore.state === "running",
      watchapi: this.states.watchapi.state === "running",
    }
  }

  /** Connection info useful for diagnostics */
  public getConnectionInfo(): { endpoint: string; commitment: Commitment } {
    // @ts-expect-error accessing private field is not supported by types, but endpoint is part of Connection internals
    const endpoint = this.connection?._rpcEndpoint || "unknown"
    const commitment = (this.cfg.commitment ?? "confirmed") as Commitment
    return { endpoint, commitment }
  }

  /** Wait for a module to reach a desired state or time out */
  public async waitForStatus(
    name: "scanline" | "watchcore" | "watchapi",
    desired: ModuleState,
    timeoutMs = 10_000,
    pollMs = 100
  ): Promise<Result<void>> {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      if (this.states[name].state === desired) return { ok: true, value: undefined }
      await delay(pollMs)
    }
    return { ok: false, error: new Error(`Timeout waiting for ${name} to reach ${desired}`) }
  }

  // ---------- internals ----------

  private async startModuleWithRetry(
    name: "scanline" | "watchcore" | "watchapi",
    action: () => Promise<void>
  ): Promise<void> {
    if (this.states[name].state === "running") {
      logger.info(`${name} already running`)
      return
    }

    let attempt = 0
    const maxAttempts = this.startRetries + 1

    while (attempt < maxAttempts) {
      attempt++
      const meta = { attempt, maxAttempts, apiPort: name === "watchapi" ? this.apiPort : undefined }
      this.hooks.onBeforeStart(name)
      this.setState(name, "starting")
      const t0 = Date.now()
      try {
        logger.info(`Starting ${name}`, meta)
        await action()
        this.setState(name, "running")
        this.states[name].startedAt = Date.now()
        this.hooks.onAfterStart(name)
        logger.info(`${name} started`, { durationMs: Date.now() - t0 })
        return
      } catch (err: any) {
        this.setState(name, "error")
        logger.error(`Error starting ${name}`, { error: err?.message ?? String(err), ...meta })
        this.hooks.onError(name, err)
        if (attempt >= maxAttempts) {
          throw err
        }
        await delay(this.startRetryDelayMs)
      }
    }
  }

  private async stopModule(
    name: "scanline" | "watchcore" | "watchapi",
    action: () => Promise<void>
  ): Promise<void> {
    const cur = this.states[name].state
    if (cur === "stopped" || cur === "idle") {
      logger.info(`${name} already stopped`)
      return
    }
    this.hooks.onBeforeStop(name)
    this.setState(name, "stopping")
    const t0 = Date.now()
    try {
      logger.info(`Stopping ${name}`)
      await action()
      this.setState(name, "stopped")
      this.hooks.onAfterStop(name)
      logger.info(`${name} stopped`, { durationMs: Date.now() - t0 })
    } catch (err: any) {
      this.setState(name, "error")
      logger.error(`Error stopping ${name}`, { error: err?.message ?? String(err) })
      this.hooks.onError(name, err)
      // do not rethrow on stop
    }
  }

  private setState(name: "scanline" | "watchcore" | "watchapi", next: ModuleState): void {
    const prev = this.states[name].state
    if (prev === next) return
    this.states[name].state = next
    this.states[name].lastChange = Date.now()
    this.hooks.onStateChange(name, prev, next)
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

function mapValues<V, R>(obj: Record<string, V>, fn: (v: V, k: string) => R): Record<string, R> {
  const out: Record<string, R> = {}
  for (const k of Object.keys(obj)) {
    out[k] = fn(obj[k], k)
  }
  return out
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function validateConfig(cfg: InitstackConfig): void {
  if (!cfg.rpcUrl) throw new Error("rpcUrl is required")
  if (!cfg.scanlineWallet) throw new Error("scanlineWallet is required")
  if (!cfg.watchcoreAccounts?.length) {
    throw new Error("watchcoreAccounts must include at least one address")
  }
  if (cfg.apiPort !== undefined) {
    const p = numberOrDefault(cfg.apiPort, 3000, 1, 65_535)
    if (p !== cfg.apiPort) {
      throw new Error("apiPort must be an integer within 1..65535")
    }
  }
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
    startRetries: numberOrDefault(process.env.START_RETRIES, 2, 0, 10),
    startRetryDelayMs: numberOrDefault(process.env.START_RETRY_DELAY_MS, 2000, 0, 120_000),
    hooks: {
      onError: (mod, err) => console.error(`Hook error in ${mod}:`, err),
      onStateChange: (mod, prev, next) => logger.info("state change", { mod, prev, next }),
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
    logger.info("Initstack is up", { status: stack.getStatus(), health: stack.getHealth(), conn: stack.getConnectionInfo() })
  } catch (err: any) {
    logger.error("Initstack failed to start", { error: err?.message ?? String(err) })
    process.exit(1)
  }
}

if (require.main === module) {
  bootstrap()
}

/*
Suggested filenames
- initstack_runner.ts
- initstack_orchestrator.ts
- initstack_bootstrap.ts
*/
