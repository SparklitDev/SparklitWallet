

import { AccountInfo, ParsedAccountData } from "@solana/web3.js"

/**
 * Represents a token balance for a mint
 */
export interface TokenBalanceInfo {
  mint: string
  balance: number
}

/**
 * Convert lamports to SOL (1 SOL = 1e9 lamports)
 */
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000
}

/**
 * Shorten a public key string for display
 */
export function shortenKey(key: string, length: number = 8): string {
  if (key.length <= length * 2) return key
  return `${key.slice(0, length)}...${key.slice(-length)}`
}

/**
 * Parse token account responses into TokenBalanceInfo[]
 */
export function parseTokenAccounts(
  accounts: { pubkey: any; account: AccountInfo<ParsedAccountData> }[]
): TokenBalanceInfo[] {
  return accounts.map(({ account }) => {
    const info = account.data.parsed.info
    return {
      mint: info.mint as string,
      balance: info.tokenAmount.uiAmount as number
    }
  })
}

/**
 * Filter out zero balances
 */
export function filterNonZeroTokenBalances(
  tokens: TokenBalanceInfo[]
): TokenBalanceInfo[] {
  return tokens.filter(t => t.balance > 0)
}
