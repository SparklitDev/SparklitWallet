
import { TransferEvent } from "../watchcore/watchcoreUtils"

/**
 * API-friendly event structure
 */
export interface ApiEvent {
  id: number
  account: string
  signature: string
  amount: number
  source: string
  destination: string
  slot: number
  timestamp: number
}

/**
 * In-memory store for API events
 */
export class EventStore {
  private events: ApiEvent[] = []
  private nextId = 1

  /**
   * Add a new event to the store
   */
  add(event: Omit<ApiEvent, "id" | "timestamp">): void {
    const apiEvent: ApiEvent = {
      id: this.nextId++,
      timestamp: Date.now(),
      ...event,
    }
    this.events.push(apiEvent)
    // keep only latest 1000 events
    if (this.events.length > 1000) {
      this.events.shift()
    }
  }

  /**
   * Get events since a given ID
   */
  getSince(sinceId: number): ApiEvent[] {
    return this.events.filter((e) => e.id > sinceId)
  }

  /**
   * Total count of stored events
   */
  count(): number {
    return this.events.length
  }
}

/**
 * Format a TransferEvent into an ApiEvent payload
 */
export function formatEventForApi(
  account: string,
  ev: TransferEvent
): Omit<ApiEvent, "id" | "timestamp"> {
  return {
    account,
    signature: ev.signature,
    amount: ev.amount,
    source: ev.source,
    destination: ev.destination,
    slot: ev.slot,
  }
}
