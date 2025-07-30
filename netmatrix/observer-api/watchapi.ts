import express, { Request, Response, NextFunction } from "express"
import { json } from "body-parser"
import { PublicKey, Connection } from "@solana/web3.js"
import { Watchcore } from "../watchcore/watchcore"
import { TransferEvent } from "../watchcore/watchcoreUtils"
import { formatEventForApi, EventStore } from "./watchapiUtils"
import { z, ZodError } from "zod"

/** Configuration options for WatchAPI server */
export interface WatchapiConfig {
  port: number
  solanaRpcUrl: string
  pollingIntervalMs: number
  maxSignaturesPerAccount: number
  minLamportsThreshold: number
}

/** Validation schemas */
const WatchRequestSchema = z.object({
  account: z.string().length(44, "Invalid Solana address"),
})
const EventsQuerySchema = z.object({
  since: z
    .string()
    .optional()
    .transform((s) => (s ? Number(s) : 0))
    .refine((n) => !isNaN(n) && n >= 0, "since must be a non-negative number"),
})

/** Structured logger */
const logger = {
  info: (msg: string, meta: any = {}) =>
    console.log({ level: "info", timestamp: new Date().toISOString(), msg, ...meta }),
  warn: (msg: string, meta: any = {}) =>
    console.warn({ level: "warn", timestamp: new Date().toISOString(), msg, ...meta }),
  error: (msg: string, meta: any = {}) =>
    console.error({ level: "error", timestamp: new Date().toISOString(), msg, ...meta }),
}

/** In-memory store for active watchers and events */
const eventStore = new EventStore()
const watchers = new Map<string, Watchcore>()

export class Watchapi {
  private app = express()
  private server?: ReturnType<typeof this.app.listen>
  private config: WatchapiConfig

  constructor(config: Partial<WatchapiConfig>) {
    this.config = {
      port: config.port ?? 3000,
      solanaRpcUrl: config.solanaRpcUrl,
      pollingIntervalMs: config.pollingIntervalMs ?? 60_000,
      maxSignaturesPerAccount: config.maxSignaturesPerAccount ?? 1000,
      minLamportsThreshold: config.minLamportsThreshold ?? 0,
    }
    this.app.use(json())
    this.app.use(this.errorHandler.bind(this))
    this.setupRoutes()
  }

  private setupRoutes(): void {
    this.app.get("/status", this.wrap(this.handleStatus.bind(this)))
    this.app.post("/watch", this.wrap(this.handleStartWatch.bind(this)))
    this.app.post("/unwatch", this.wrap(this.handleStopWatch.bind(this)))
    this.app.get("/events", this.wrap(this.handleGetEvents.bind(this)))
  }

  /** Start the HTTP server */
  public start(): void {
    this.server = this.app.listen(this.config.port, () => {
      logger.info("WatchAPI listening", { port: this.config.port })
    })
  }

  /** Stop server and all watchers */
  public stop(): void {
    watchers.forEach((w) => w.stop())
    if (this.server) {
      this.server.close(() => logger.info("HTTP server closed"))
    }
  }

  private async handleStatus(req: Request, res: Response) {
    res.json({
      watchers: [...watchers.keys()],
      eventCount: eventStore.count(),
    })
  }

  private async handleStartWatch(req: Request, res: Response) {
    const parsed = WatchRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map(e => e.message) })
    }
    const key = parsed.data.account
    if (watchers.has(key)) {
      return res.json({ message: `Already watching ${key}` })
    }
    try {
      const connection = new Connection(this.config.solanaRpcUrl, "confirmed")
      const pubkey = new PublicKey(key)
      const watcher = new Watchcore({
        connection,
        trackedAccounts: [pubkey],
        pollingIntervalMs: this.config.pollingIntervalMs,
        maxSignaturesPerAccount: this.config.maxSignaturesPerAccount,
        minLamportsThreshold: this.config.minLamportsThreshold,
      })
      watcher.handleEvent = (account, event: TransferEvent) => {
        const formatted = formatEventForApi(account.toBase58(), event)
        eventStore.add(formatted)
      }
      watcher.start()
      watchers.set(key, watcher)
      logger.info("Started watcher", { account: key })
      res.json({ message: `Started watching ${key}` })
    } catch (err: any) {
      logger.error("Failed to start watcher", { account: key, error: err.message })
      res.status(500).json({ error: err.message })
    }
  }

  private async handleStopWatch(req: Request, res: Response) {
    const parsed = WatchRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map(e => e.message) })
    }
    const key = parsed.data.account
    const watcher = watchers.get(key)
    if (!watcher) {
      return res.status(404).json({ error: `No watcher for ${key}` })
    }
    watcher.stop()
    watchers.delete(key)
    logger.info("Stopped watcher", { account: key })
    res.json({ message: `Stopped watching ${key}` })
  }

  private async handleGetEvents(req: Request, res: Response) {
    const parsed = EventsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map(e => e.message) })
    }
    const since = parsed.data.since
    const events = eventStore.getSince(since)
    res.json({ events })
  }

  /** Wrapper to catch and forward async errors */
  private wrap(fn: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next)
    }
  }

  /** Central error handler */
  private errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.errors.map(e => e.message) })
    } else {
      logger.error("Unhandled error", { error: err.message })
      res.status(500).json({ error: "Internal server error" })
    }
  }
}

if (require.main === module) {
  const api = new Watchapi({ solanaRpcUrl: "https://api.mainnet-beta.solana.com" })
  api.start()
}
