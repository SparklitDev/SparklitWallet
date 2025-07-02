import { Connection } from "@solana/web3.js"
import { Scanline, ScanlineConfig } from "../sparklit/scanline/scanline"
import { Watchcore, WatchcoreConfig } from "../watchcore/watchcore"
import { Watchapi, WatchapiConfig } from "../watchapi/watchapi"
import { PublicKey } from "@solana/web3.js"

interface InitstackConfig {
  rpcUrl: string
  scanlineWallet: string
  watchcoreAccounts: string[]
  apiPort?: number
  pollingIntervalMs?: number
  scanlineThresholdLamports?: number
  watchcoreThresholdLamports?: number
}

export class Initstack {
  private connection: Connection
  private scanline: Scanline
  private watchcore: Watchcore
  private watchapi: Watchapi

  constructor(private config: InitstackConfig) {
    this.connection = new Connection(this.config.rpcUrl)

    const scanConfig: ScanlineConfig = {
      connection: this.connection,
      walletPublicKey: new PublicKey(this.config.scanlineWallet),
      lamportsThreshold: this.config.scanlineThresholdLamports,
      pollingIntervalMs: this.config.pollingIntervalMs,
    }
    this.scanline = new Scanline(scanConfig)

    const trackedKeys = this.config.watchcoreAccounts.map(
      (addr) => new PublicKey(addr)
    )
    const coreConfig: WatchcoreConfig = {
      connection: this.connection,
      trackedAccounts: trackedKeys,
      minLamportsThreshold: this.config.watchcoreThresholdLamports,
      pollingIntervalMs: this.config.pollingIntervalMs,
    }
    this.watchcore = new Watchcore(coreConfig)

    const apiConfig: WatchapiConfig = {
      solanaRpcUrl: this.config.rpcUrl,
      port: this.config.apiPort,
      pollingIntervalMs: this.config.pollingIntervalMs,
      maxSignaturesPerAccount: trackedKeys.length * 50,
      minLamportsThreshold: this.config.watchcoreThresholdLamports,
    }
    this.watchapi = new Watchapi(apiConfig)
  }

  /**
   * Initialize all modules: scanline, watchcore, and API
   */
  public async startAll(): Promise<void> {
    console.log("🔧 Initializing connection to", this.config.rpcUrl)
    this.scanline.start()
    console.log("🔍 Scanline started")
    this.watchcore.start()
    console.log("🔍 Watchcore started")
    this.watchapi.start()
    console.log(`🌐 WatchAPI listening on port ${this.config.apiPort}`)
  }

  /**
   * Stop all running modules
   */
  public async stopAll(): Promise<void> {
    console.log("🚫 Stopping Scanline")
    this.scanline.stop()
    console.log("🚫 Stopping Watchcore")
    this.watchcore.stop()
    console.log("🚫 Stopping WatchAPI")
    this.watchapi.stop()
  }
}

/**
 * Example bootstrap using environment variables
 */
async function bootstrap(): Promise<void> {
  const cfg: InitstackConfig = {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    scanlineWallet: process.env.SCANLINE_WALLET || "",
    watchcoreAccounts: (process.env.WATCHCORE_ACCOUNTS || "").split(","),
    apiPort: Number(process.env.API_PORT) || 3000,
    pollingIntervalMs: Number(process.env.POLL_INTERVAL) || 60000,
    scanlineThresholdLamports: Number(process.env.SCANLINE_THRESHOLD) || 1_000_000_000,
    watchcoreThresholdLamports: Number(process.env.WATCHCORE_THRESHOLD) || 500_000_000,
  }

  if (!cfg.scanlineWallet || cfg.watchcoreAccounts.length === 0) {
    console.error("❌ Missing required environment configuration")
    process.exit(1)
  }

  const stack = new Initstack(cfg)
  await stack.startAll()

  // handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("💤 Graceful shutdown initiated")
    await stack.stopAll()
    process.exit(0)
  })
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error("Initialization error:", err)
    process.exit(1)
  })
}
