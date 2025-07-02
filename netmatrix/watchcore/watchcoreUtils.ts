

import { ParsedConfirmedTransaction } from "@solana/web3.js"

/**
 * TransferEvent describes a parsed transfer instruction
 */
export interface TransferEvent {
  signature: string
  amount: number
  source: string
  destination: string
  slot: number
}

/**
 * Decode transfer instructions from a parsed transaction
 */
export function decodeTransferInstructions(
  tx: ParsedConfirmedTransaction
): TransferEvent[] {
  const results: TransferEvent[] = []
  const sig = tx.transaction.signatures[0]
  const slot = tx.slot

  const instructions = tx.transaction.message.instructions
  for (const instr of instructions) {
    if ("parsed" in instr && instr.parsed.type === "transfer") {
      const info = instr.parsed.info
      const amount = Number(info.lamports)
      const source = info.source as string
      const destination = info.destination as string
      results.push({
        signature: sig,
        amount,
        source,
        destination,
        slot,
      })
    }
  }
  return results
}

/**
 * Convert lamports to SOL (1 SOL = 1e9 lamports)
 */
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000
}

/**
 * Format a public key string for display (shortened)
 */
export function shortenKey(key: string, length: number = 6): string {
  if (key.length <= length * 2) return key
  return `${key.slice(0, length)}...${key.slice(-length)}`
}
