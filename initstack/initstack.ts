import { Connection, PublicKey } from "@solana/web3.js"
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
  hooks?: InitstackHooks
}

/** Simple structured logger */
const logger = {
  info: (msg: string, meta: any = {}) =>
    console.log({ level: "info", timestamp: new Date().toISOString(), msg, ...meta }),
  warn: (msg: string, meta: any = {}) =>
    console.warn({ level: "warn", timestamp: new Date().toISOString(), msg, ...meta }),
  error: (msg: string, meta: any = {}) =>
    console.error({ level: "error", timestamp: new Date().toISOString(), msg, ...meta }),
}

export class Initstack {
  private connection: Connection
  private scanline: Scanline
  private watchcore: Watchcore
  private watchapi: Watchapi
  private hooks: Required<InitstackHooks>
  private apiPort: number

  constructor(private cfg: InitstackConfig) {
    // merge hooks with no-ops
    this.hooks = {
      onBeforeStart: cfg.hooks?.onBeforeStart ?? (() => {}),
      onAfterStart:  cfg.hooks?.onAfterStart  ?? (() => {}),
      onBeforeStop:  cfg.hooks?.onBeforeStop  ?? (() => {}),
      onAfterStop:   cfg.hooks?.onAfterStop   ?? (() => {}),
      onError:       cfg.hooks?.onError       ?? (() => {}),
    }

    // validate required fields
    if (!cfg.rpcUrl) throw new Error("rpcUrl is required")
    if (!cfg.scanlineWallet) throw new Error("scanlineWallet is required")
    if (!cfg.watchcoreAccounts?.length) throw new Error("watchcoreAccounts must include at least one address")

    // defaults
    const pollingIntervalMs      = cfg.pollingIntervalMs      ?? 60_000
    const scanlineThreshold      = cfg.scanlineThresholdLamports ?? 1_000_000_000
    const watchcoreThreshold     = cfg.watchcoreThresholdLamports ?? 500_000_000
    this.apiPort = cfg.apiPort ?? 3000

    // initialize connection
    this.connection = new Connection(cfg.rpcUrl, "confirmed")

    // build modules
    try {
      const scanConfig: ScanlineConfig = {
        connection: this.connection,
        walletPublicKey: new PublicKey(cfg.scanlineWallet),
        lamportsThreshold: scanlineThreshold,
        pollingIntervalMs,
      }
      this.scanline = new Scanline(scanConfig)

      const tracked = cfg.watchcoreAccounts.map((addr) => new PublicKey(addr))
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
        maxSignaturesPerAccount: tracked.length * 50,
        minLamportsThreshold: watchcoreThreshold,
      }
      this.watchapi = new Watchapi(apiConfig)
    } catch (err: any) {
      logger.error("Failed to initialize modules", { error: err.message })
      throw err
    }
  }

  /** Initialize and start all modules */
  public async startAll(): Promise<void> {
    for (const [name, starter] of Object.entries({
      scanline:    () => this.scanline.start(),
      watchcore:   () => this.watchcore.start(),
      watchapi:    () => this.watchapi.start(),
    })) {
      try {
        this.hooks.onBeforeStart(name)
        logger.info(`Starting ${name}`, { apiPort: name === "watchapi" ? this.apiPort : undefined })
        await starter()
        this.hooks.onAfterStart(name)
        logger.info(`${name} started`)
      } catch (err: any) {
        logger.error(`Error starting ${name}`, { error: err.message })
        this.hooks.onError(name, err)
        throw err
      }
    }
    logger.info("All modules started")
  }

  /** Stop all running modules */
  public async stopAll(): Promise<void> {
    for (const [name, stopper] of Object.entries({
      scanline:  () => this.scanline.stop(),
      watchcore: () => this.watchcore.stop(),
      watchapi:  () => this.watchapi.stop(),
    })) {
      try {
        this.hooks.onBeforeStop(name)
        logger.info(`Stopping ${name}`)
        await stopper()
        this.hooks.onAfterStop(name)
        logger.info(`${name} stopped`)
      } catch (err: any) {
        logger.error(`Error stopping ${name}`, { error: err.message })
        this.hooks.onError(name, err)
      }
    }
    logger.info("All modules stopped")
  }
}

// Example bootstrap (can be extracted to a separate script)
async function bootstrap(): Promise<void> {
  const cfg: InitstackConfig = {
    rpcUrl:                    process.env.SOLANA_RPC_URL       || "https://api.mainnet-beta.solana.com",
    scanlineWallet:            process.env.SCANLINE_WALLET     || "",
    watchcoreAccounts:         (process.env.WATCHCORE_ACCOUNTS  || "").split(",").filter(Boolean),
    apiPort:                   Number(process.env.API_PORT)     || 3000,
    pollingIntervalMs:         Number(process.env.POLL_INTERVAL)|| 60000,
    scanlineThresholdLamports: Number(process.env.SCANLINE_THRESHOLD)|| 1_000_000_000,
    watchcoreThresholdLamports:Number(process.env.WATCHCORE_THRESHOLD)|| 500_000_000,
    hooks: {
      onError: (mod, err) => console.error(`Hook error in ${mod}:`, err),
    }
  }

  const stack = new Initstack(cfg)
  try {
    await stack.startAll()
    process.on("SIGINT", async () => {
      logger.info("Graceful shutdown initiated")
      await stack.stopAll()
      process.exit(0)
    })
  } catch {
    process.exit(1)
  }
}

if (require.main === module) {
  bootstrap()
}
