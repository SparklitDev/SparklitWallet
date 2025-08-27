import {
  AccountInfo,
  ParsedAccountData,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js"

/**
 * TokenBalanceInfo describes a token mint and its human-readable balance (UI units)
 */
export interface TokenBalanceInfo {
  mint: string
  balance: number
}

/**
 * Convert lamports to SOL (1 SOL = 1e9 lamports)
 */
export function lamportsToSol(lamports: number): number {
  return Number(lamports) / LAMPORTS_PER_SOL
}

/**
 * Shorten a public key string for display
 */
export function shortenKey(key: string, length = 8): string {
  const len = Math.max(1, Math.floor(length))
  if (!key || key.length <= len * 2) return key
  return `${key.slice(0, len)}…${key.slice(-len)}`
}

/**
 * Narrow the ParsedAccountData payload to the token account shape
 */
function getParsedTokenInfo(account: AccountInfo<ParsedAccountData>) {
  const parsed = account.data?.parsed as any
  const info = parsed?.info
  const tokenAmount = info?.tokenAmount
  const mint = String(info?.mint ?? "")
  const uiAmount: number | undefined =
    typeof tokenAmount?.uiAmount === "number"
      ? tokenAmount.uiAmount
      : tokenAmount?.uiAmountString
      ? Number(tokenAmount.uiAmountString)
      : undefined
  const rawAmount = tokenAmount?.amount !== undefined ? Number(tokenAmount.amount) : undefined
  const decimals = tokenAmount?.decimals !== undefined ? Number(tokenAmount.decimals) : undefined
  return { mint, uiAmount, rawAmount, decimals }
}

/**
 * Compute UI amount from raw + decimals if needed
 */
function toUiAmount(uiAmount: number | undefined, rawAmount: number | undefined, decimals: number | undefined): number {
  if (typeof uiAmount === "number" && Number.isFinite(uiAmount)) return uiAmount
  if (Number.isFinite(rawAmount) && Number.isFinite(decimals)) {
    return rawAmount! / Math.pow(10, decimals!)
  }
  return 0
}

/**
 * Parse and format token account responses into TokenBalanceInfo[]
 * - Safely handles both uiAmount and raw amount+decimals
 * - Returns one entry per input account (no aggregation)
 */
export function formatTokenAccounts(
  accounts: ReadonlyArray<{ pubkey: PublicKey; account: AccountInfo<ParsedAccountData> }>
): TokenBalanceInfo[] {
  return accounts.map(({ account }) => {
    const { mint, uiAmount, rawAmount, decimals } = getParsedTokenInfo(account)
    return {
      mint,
      balance: toUiAmount(uiAmount, rawAmount, decimals),
    }
  })
}

/**
 * Aggregate balances by mint (summing across multiple token accounts)
 */
export function aggregateTokenBalances(
  tokens: ReadonlyArray<TokenBalanceInfo>
): TokenBalanceInfo[] {
  const map = new Map<string, number>()
  for (const t of tokens) {
    if (!t.mint) continue
    map.set(t.mint, (map.get(t.mint) ?? 0) + (Number.isFinite(t.balance) ? t.balance : 0))
  }
  return Array.from(map, ([mint, balance]) => ({ mint, balance }))
}

/**
 * Filter out zero (or near-zero) balances
 */
export function filterNonZeroTokenBalances(
  tokens: ReadonlyArray<TokenBalanceInfo>,
  epsilon = 0
): TokenBalanceInfo[] {
  const eps = Math.max(0, epsilon)
  return tokens.filter(t => Math.abs(t.balance) > eps)
}

/**
 * Sort balances in descending order
 */
export function sortByBalanceDesc(tokens: ReadonlyArray<TokenBalanceInfo>): TokenBalanceInfo[] {
  return [...tokens].sort((a, b) => b.balance - a.balance)
}
