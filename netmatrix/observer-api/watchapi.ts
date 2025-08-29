// watchapi.ts

import http from "http"
import express, { Request, Response, NextFunction } from "express"
import { json as bodyJson } from "body-parser"
import { PublicKey, Connection, Commitment } from "@solana/web3.js"
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
  commitment?: Commitment
}

/** Validation schemas */
const BASE58_32_44 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

const WatchRequestSchema = z.object({
  account: z
    .string()
    .regex(BASE58_32_44, "Invalid Solana address"),
})

/** since can be:
 *  - number ms since epoch
 *  - numeric string
 *  - ISO datetime string
 */
const EventsQuerySchema = z.object({
  since: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined) return 0
      if (typeof v === "number") return v
      const trimmed = v.trim()
      // numeric string?
      const asNum = Number(trimmed)
      if (Number.isFinite(asNum)) return asNum
      const asDate = new Date(trimmed).getTime()
      return Number.isFinite(asDate) ? asDate : NaN
    })
    .refine((n) => Number.isFinite(n) && n >= 0, "since must be a non-negative number or valid date"),
})

/** Structured logger */
const logger = {
  info: (msg: string, meta: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), msg, ...meta })),
  warn: (msg: string, meta: Record<string, unknown> = {}) =>
    console.warn(JSON.stringify({ level: "warn", ts: new Date().toISOString(), msg, ...meta })),
  error: (msg: string, meta: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ level: "error", ts: new Date().toISOString(), msg, ...meta })),
}

/** In-memory store for active watchers and events */
const eventStore = new EventStore()
const watchers = new Map<string, Watchcore>()

export class Watchapi {
  private readonly app = express()
  private server?: http.Server
  private readonly config: Required<WatchapiConfig>
  private readonly connection: Connection
  private readonly startedAt = Date.now()

  constructor(config: Partial<WatchapiConfig>) {
    // Build config with defaults & validation
    const full: Required<WatchapiConfig> = {
      port: config.port ?? 3000,
      solanaRpcUrl: mustString(config.solanaRpcUrl, "solanaRpcUrl"),
      pollingIntervalMs: numberOrDefault(config.pollingIntervalMs, 60_000, 100),
      maxSignaturesPerAccount: numberOrDefault(config.maxSignaturesPerAccount, 1000, 1),
      minLamportsThreshold: numberOrDefault(config.minLamportsThreshold, 0, 0),
      commitment: (config.commitment ?? "confirmed") as Commitment,
    }
    this.config = full

    // Single shared RPC connection
    this.connection = new Connection(this.config.solanaRpcUrl, this.config.commitment)

    // Middleware
    this.app.disable("x-powered-by")
    this.app.use(bodyJson())

    // Attach request id for tracing
    this.app.use((req, _res, next) => {
      ;(req as any).reqId = genReqId()
      next()
    })

    // Routes
    this.setupRoutes()

    // Not-found route
    this.app.use((_req, res) => {
      res.status(404).json({ error: "Not found" })
    })

    // Central error handler — must be last
    this.app.use(this.errorHandler.bind(this))
  }

  private setupRoutes(): void {
    this.app.get("/health", this.wrap(async (_req, res) => {
      res.json({ ok: true, ts: Date.now() })
    }))

    this.app.get("/status", this.wrap(this.handleStatus.bind(this)))
    this.app.post("/watch", this.wrap(this.handleStartWatch.bind(this)))
    this.app.post("/unwatch", this.wrap(this.handleStopWatch.bind(this)))
    this.app.get("/events", this.wrap(this.handleGetEvents.bind(this)))
  }

  /** Start the HTTP server */
  public async start(): Promise<void> {
    if (this.server) return
    await new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(this.config.port)
      this.server.once("listening", () => {
        logger.info("WatchAPI listening", { port: this.config.port })
        resolve()
      })
      this.server.once("error", (err) => {
        logger.error("HTTP server error", { error: (err as any)?.message ?? String(err) })
        reject(err)
      })
    })
  }

  /** Stop server and all watchers */
  public async stop(): Promise<void> {
    // stop watchers first
    await Promise.all(
      [...watchers.values()].map(async (w) => {
        try {
          await w.stop()
        } catch (err: any) {
          logger.warn("Watcher stop error", { error: err?.message ?? String(err) })
        }
      })
    )
    watchers.clear()

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          logger.info("HTTP server closed")
          this.server = undefined
          resolve()
        })
      })
    }
  }

  // -------------------- handlers --------------------

  private async handleStatus(_req: Request, res: Response) {
    res.json({
      watchers: [...watchers.keys()],
      eventCount: eventStore.count(),
      startedAt: this.startedAt,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      commitment: this.config.commitment,
    })
  }

  private async handleStartWatch(req: Request, res: Response) {
    const parsed = WatchRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((e) => e.message) })
    }
    const key = parsed.data.account
    if (watchers.has(key)) {
      return res.json({ message: `Already watching ${key}` })
    }
    try {
      const pubkey = new PublicKey(key)
      const watcher = new Watchcore({
        connection: this.connection,
        trackedAccounts: [pubkey],
        pollingIntervalMs: this.config.pollingIntervalMs,
        maxSignaturesPerAccount: this.config.maxSignaturesPerAccount,
        minLamportsThreshold: this.config.minLamportsThreshold,
      })

      // bind event handler
      watcher.handleEvent = (account, event: TransferEvent) => {
        const formatted = formatEventForApi(account.toBase58(), event)
        eventStore.add(formatted)
      }

      await watcher.start()
      watchers.set(key, watcher)
      logger.info("Started watcher", { account: key })
      res.json({ message: `Started watching ${key}` })
    } catch (err: any) {
      logger.error("Failed to start watcher", { account: key, error: err?.message ?? String(err) })
      res.status(500).json({ error: err?.message ?? "Failed to start watcher" })
    }
  }

  private async handleStopWatch(req: Request, res: Response) {
    const parsed = WatchRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((e) => e.message) })
    }
    const key = parsed.data.account
    const watcher = watchers.get(key)
    if (!watcher) {
      return res.status(404).json({ error: `No watcher for ${key}` })
    }
    try {
      await watcher.stop()
    } catch (err: any) {
      logger.warn("Error during watcher stop", { account: key, error: err?.message ?? String(err) })
    }
    watchers.delete(key)
    logger.info("Stopped watcher", { account: key })
    res.json({ message: `Stopped watching ${key}` })
  }

  private async handleGetEvents(req: Request, res: Response) {
    const parsed = EventsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors.map((e) => e.message) })
    }
    const since = parsed.data.since as number
    const events = eventStore.getSince(since)
    // Very light caching: events are append-only; allow caches for a few seconds
    res.setHeader("Cache-Control", "public, max-age=3, stale-while-revalidate=30")
    res.json({ events, count: events.length, since })
  }

  /** Wrapper to catch and forward async errors */
  private wrap(fn: (req: Request, res: Response) => Promise<void | unknown>) {
    return (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res)).catch(next)
    }
  }

  /** Central error handler */
  private errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors.map((e) => e.message) })
    }
    logger.error("Unhandled error", { error: err?.message ?? String(err) })
    res.status(500).json({ error: "Internal server error" })
  }
}

// -------------- helpers --------------

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

function mustString(v: unknown, field: string): string {
  if (typeof v === "string" && v.trim() !== "") return v
  throw new Error(`Missing required config: ${field}`)
}

function genReqId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// CLI bootstrap
if (require.main === module) {
  const api = new Watchapi({
    solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    port: Number(process.env.API_PORT) || 3000,
    pollingIntervalMs: Number(process.env.POLL_INTERVAL) || 60_000,
    maxSignaturesPerAccount: Number(process.env.MAX_SIGS) || 1000,
    minLamportsThreshold: Number(process.env.MIN_LAMPORTS) || 0,
    commitment: (process.env.SOLANA_COMMITMENT as Commitment) || "confirmed",
  })
  api
    .start()
    .then(() => {
      logger.info("WatchAPI started")
      const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}, shutting down`)
        await api.stop()
        process.exit(0)
      }
      process.on("SIGINT", () => void shutdown("SIGINT"))
      process.on("SIGTERM", () => void shutdown("SIGTERM"))
    })
    .catch(() => process.exit(1))
}
