// intelframe/intelframeUtils.ts

import { ParsedConfirmedTransaction } from "@solana/web3.js"

/**
 * A transfer event extracted from transactions
 */
export interface TransferEvent {
  amount: number
  source: string
  destination: string
  slot: number
  timestamp: number
}

/**
 * Insight result from analysis
 */
export interface Insight {
  type: string
  message: string
  data?: any
}

/**
 * Extracts transfer events from parsed transactions
 */
export function extractTransferEvents(
  txs: ParsedConfirmedTransaction[]
): TransferEvent[] {
  const events: TransferEvent[] = []
  for (const tx of txs) {
    const slot = tx.slot
    const timestamp = tx.blockTime ?? 0
    for (const instr of tx.transaction.message.instructions) {
      if ("parsed" in instr && instr.parsed.type === "transfer") {
        const info = instr.parsed.info
        events.push({
          amount: Number(info.lamports),
          source: info.source,
          destination: info.destination,
          slot,
          timestamp
        })
      }
    }
  }
  return events
}

/**
 * Analyze volume spikes in transfer events
 * Returns insights when sudden increases are detected
 */
export function analyzeVolumeSpikes(
  events: TransferEvent[]
): Insight[] {
  const insights: Insight[] = []
  if (events.length === 0) return insights

  // Group by minute intervals
  const buckets: Record<number, number> = {}
  for (const e of events) {
    const minute = Math.floor(e.timestamp / 60)
    buckets[minute] = (buckets[minute] || 0) + e.amount
  }

  const minutes = Object.keys(buckets)
    .map(m => parseInt(m))
    .sort((a, b) => a - b)

  for (let i = 1; i < minutes.length; i++) {
    const prev = buckets[minutes[i - 1]]
    const curr = buckets[minutes[i]]
    if (prev > 0 && curr / prev >= 2) {
      insights.push({
        type: "VolumeSpike",
        message: `transfer volume doubled from ${prev} to ${curr} lamports`,
        data: { previous: prev, current: curr, interval: minutes[i] }
      })
    }
  }
  return insights
}
