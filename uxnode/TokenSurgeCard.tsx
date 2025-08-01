import React, { useMemo } from 'react'

interface TokenSurgeCardProps {
  name: string
  symbol: string
  surgePercent: number
  timestamp: number  // epoch ms
  onClick?: () => void
}

export const TokenSurgeCard: React.FC<TokenSurgeCardProps> = React.memo(({
  name,
  symbol,
  surgePercent,
  timestamp,
  onClick,
}) => {
  const dateString = useMemo(
    () => new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    [timestamp]
  )

  const isPositive = surgePercent >= 0
  const trendClass = isPositive ? 'text-green-600' : 'text-red-600'
  const arrow = isPositive ? '▲' : '▼'
  const absPercent = Math.abs(surgePercent).toFixed(1)

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-label={`${name} (${symbol}) surged ${absPercent}% as of ${dateString}`}
      className={`
        w-full text-left border rounded-2xl p-4 shadow-lg 
        hover:shadow-xl focus:shadow-xl transition 
        focus:outline-none focus:ring-2 focus:ring-offset-2 
        focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-default
      `}
    >
      <header className="flex justify-between items-center mb-2">
        <h3 className="text-xl font-semibold">
          {name}{' '}
          <span className="text-sm text-gray-400">({symbol})</span>
        </h3>
        <span className={`font-bold ${trendClass}`}>
          {arrow} {absPercent}%
        </span>
      </header>
      <p className="text-sm text-gray-500">As of {dateString}</p>
    </button>
  )
})

TokenSurgeCard.displayName = 'TokenSurgeCard'
 
