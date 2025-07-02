
export function calculateMidPrice(bid: number, ask: number): number {
  return (bid + ask) / 2
}


export function shortenKey(key: string, length: number = 8): string {
  if (key.length <= length * 2) return key
  return `${key.slice(0, length)}...${key.slice(-length)}`
}


export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000
}
