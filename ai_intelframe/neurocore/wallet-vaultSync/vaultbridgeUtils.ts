
import {
  AccountInfo,
  PublicKey
} from "@solana/web3.js"

/**
 * Represents the parsed state of a vault
 */
export interface VaultAsset {
  mint: string
  amount: number
}

export interface VaultState {
  balance: number
  assets: VaultAsset[]
}

/**
 * Parse raw account data into VaultState
 */
export function parseVaultData(
  accountInfo: AccountInfo<Buffer>
): VaultState {
  const data = accountInfo.data
  let offset = 0

  // read 8-byte balance (u64 little endian)
  const balance = Number(
    data.readBigUInt64LE(offset)
  ) / 1e9
  offset += 8

  // read asset count (u32 little endian)
  const count = data.readUInt32LE(offset)
  offset += 4

  const assets: VaultAsset[] = []
  for (let i = 0; i < count; i++) {
    // mint is 32 bytes
    const mint = new PublicKey(data.slice(offset, offset + 32)).toBase58()
    offset += 32

    // amount u64 little endian
    const raw = Number(data.readBigUInt64LE(offset))
    offset += 8

    assets.push({
      mint,
      amount: raw / 1e9
    })
  }

  return { balance, assets }
}

/**
 * Shorten a public key string for display
 */
export function shortenKey(
  key: string,
  length: number = 8
): string {
  if (key.length <= length * 2) return key
  return `${key.slice(0, length)}...${key.slice(-length)}`
}

/**
 * Convert lamports to SOL units
 */
export function lamportsToSol(
  lamports: number
): number {
  return lamports / 1e9
}
