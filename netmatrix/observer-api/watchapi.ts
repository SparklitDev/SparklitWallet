

import express, { Request, Response } from "express"
import bodyParser from "body-parser"
import { PublicKey, Connection } from "@solana/web3.js"
import { Watchcore } from "../watchcore/watchcore"
import { TransferEvent } from "../watchcore/watchcoreUtils"
import { formatEventForApi, EventStore } from "./watchapiUtils"

/**
 * Configuration options for WatchAPI server
 */
export interface WatchapiConfig {
  port?: number
  solanaRpcUrl: string
  pollingIntervalMs?: number
  maxSignaturesPerAccount?: number
  minLamportsThreshold?: number
}

// in-memory store for active watchers and events
const eventStore = new EventStore()

export class Watchapi {
  private app = express()
  private server: any
  private watchers: Map<string, Watchcore> = new Map()
  private config: WatchapiConfig

  constructor(config: WatchapiConfig) {
    this.config = {
      port: config.port ?? 3000,
      solanaRpcUrl: config.solanaRpcUrl,
      pollingIntervalMs: config.pollingIntervalMs,
      maxSignaturesPerAccount: config.maxSignaturesPerAccount,
      minLamportsThreshold: config.minLamportsThreshold,
    }
    this.app.use(bodyParser.json())
    this.setupRoutes()
  }

  /**
   * Define HTTP endpoints for WatchAPI
   */
  private setupRoutes(): void {
    this.app.get("/status", this.handleStatus.bind(this))
    this.app.post("/watch", this.handleStartWatch.bind(this))
    this.app.post("/unwatch", this.handleStopWatch.bind(this))
    this.app.get("/events", this.handleGetEvents.bind(this))
  }

  /**
   * Start the Express server
   */
  public start(): void {
    this.server = this.app.listen(this.config.port, () => {
      console.log(`WatchAPI listening on port ${this.config.port}`)
    })
  }

  /**
   * Stop the Express server and all watchers
   */
  public stop(): void {
    this.watchers.forEach((watcher) => watcher.stop())
    if (this.server) {
      this.server.close()
    }
  }

  private handleStatus(req: Request, res: Response): void {
    res.json({
      watchers: Array.from(this.watchers.keys()),
      eventCount: eventStore.count(),
    })
  }

  private async handleStartWatch(req: Request, res: Response): Promise<void> {
    try {
      const { account } = req.body
      if (!account) {
        res.status(400).json({ error: "Missing 'account' in request body" })
        return
      }
      const key = account as string
      if (this.watchers.has(key)) {
        res.json({ message: `Already watching ${key}` })
        return
      }
      const connection = new Connection(this.config.solanaRpcUrl)
      const pubkey = new PublicKey(key)
      const watcher = new Watchcore({
        connection,
        trackedAccounts: [pubkey],
        pollingIntervalMs: this.config.pollingIntervalMs,
        maxSignaturesPerAccount: this.config.maxSignaturesPerAccount,
        minLamportsThreshold: this.config.minLamportsThreshold,
      })
      watcher.start()
      watcher.handleEvent = (account, event: TransferEvent) => {
        const formatted = formatEventForApi(account.toBase58(), event)
        eventStore.add(formatted)
      }
      this.watchers.set(key, watcher)
      res.json({ message: `Started watching ${key}` })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  }

  private async handleStopWatch(req: Request, res: Response): Promise<void> {
    try {
      const { account } = req.body
      const key = account as string
      const watcher = this.watchers.get(key)
      if (!watcher) {
        res.status(404).json({ error: `No watcher for ${key}` })
        return
      }
      watcher.stop()
      this.watchers.delete(key)
      res.json({ message: `Stopped watching ${key}` })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  }

  private handleGetEvents(req: Request, res: Response): void {
    const since = Number(req.query.since) || 0
    const events = eventStore.getSince(since)
    res.json({ events })
  }
}

// instantiate and run server if this module is entrypoint
if (require.main === module) {
  const api = new Watchapi({ solanaRpcUrl: "https://api.mainnet-beta.solana.com" })
  api.start()
}
