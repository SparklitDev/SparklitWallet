import { ParsedConfirmedTransaction, ParsedInstruction } from "@solana/web3.js"

export interface TransferEvent {
  amount: number
  source: string
  destination: string
  slot: number
  timestamp: number
}

export interface Insight {
  type: string
  message: string
  data?: any
}

export function extractTransferEvents(
  txs: ParsedConfirmedTransaction[]
): TransferEvent[] {
  const events: TransferEvent[] = []

  for (const tx of txs) {
    const slot = tx.slot
    const timestamp = tx.blockTime ? tx.blockTime * 1000 : 0 // ms
    for (const instr of tx.transaction.message.instructions as ParsedInstruction[]) {
      if (
        "parsed" in instr &&
        instr.parsed?.type === "transfer" &&
        instr.parsed.info
      ) {
        const info: any = instr.parsed.info
        events.push({
          amount: Number(info.lamports ?? info.amount ?? 0),
          source: info.source,
          destination: info.destination,
          slot,
          timestamp,
        })
      }
    }
  }

  return events
}

export function analyzeVolumeSpikes(events: TransferEvent[]): Insight[] {
  const insights: Insight[] = []
  if (events.length === 0) return insights

  // Group by minute intervals
  const buckets: Record<number, number> = {}
  for (const e of events) {
    if (!e.timestamp) continue
    const minute = Math.floor(e.timestamp / (60 * 1000))
    buckets[minute] = (buckets[minute] || 0) + e.amount
  }

  const minutes = Object.keys(buckets)
    .map(m => parseInt(m, 10))
    .sort((a, b) => a - b)

  for (let i = 1; i < minutes.length; i++) {
    const prev = buckets[minutes[i - 1]]
    const curr = buckets[minutes[i]]
    if (prev > 0 && curr / prev >= 2 && curr - prev > 1_000_000) {
      insights.push({
        type: "VolumeSpike",
        message: `Transfer volume spiked from ${prev} to ${curr} lamports`,
        data: { previous: prev, current: curr, interval: minutes[i] },
      })
    }
  }

  return insights
}
