// walletmesh/walletmeshUtils.ts

import { ParsedAccountData, ParsedAccount } from "@solana/web3.js"

/**
 * Convert lamports to SOL (1 SOL = 1e9 lamports)
 */
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000
}

/**
 * Shorten a public key or mint address for display
 */
export function shortenKey(key: string, length: number = 8): string {
  if (key.length <= length * 2) return key
  return `${key.slice(0, length)}...${key.slice(-length)}`
}

/**
 * Parse token account data into mint and human-readable balance
 */
export function parseTokenAccounts(
  accounts: { pubkey: any; account: AccountInfo<ParsedAccountData> }[]
): { mint: string; balance: number }[] {
  return accounts.map(({ account }) => {
    const info = account.data.parsed.info
    const mint = info.mint as string
    const rawAmount = info.tokenAmount.uiAmount as number
    return { mint, balance: rawAmount }
  })
}

/**
 * Filter and format non-zero token balances
 */
export function filterNonZeroTokens(
  tokens: { mint: string; balance: number }[]
): { mint: string; balance: number }[] {
  return tokens.filter(t => t.balance > 0)
}

/**
 * Summarize token balances into a readable string
 */
export function summarizeTokens(
  tokens: { mint: string; balance: number }[]
): string {
  if (tokens.length === 0) return "No token balances"
  return tokens
    .map(t => `${shortenKey(t.mint)}: ${t.balance.toFixed(4)}`)
    .join(", ")
}
