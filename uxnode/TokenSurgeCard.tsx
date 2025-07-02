import React from 'react'

interface TokenSurgeCardProps {
  name: string
  symbol: string
  surgePercent: number
  timestamp: number  // epoch ms
  onClick?: () => void
}

export const TokenSurgeCard: React.FC<TokenSurgeCardProps> = ({
  name,
  symbol,
  surgePercent,
  timestamp,
  onClick,
}) => {
  const date = new Date(timestamp).toLocaleString()

  const trendClass = surgePercent >= 0 ? 'text-green-600' : 'text-red-600'
  const arrow = surgePercent >= 0 ? '▲' : '▼'

  return (
    <div
      className="border rounded-2xl p-4 shadow-lg hover:shadow-xl cursor-pointer transition"
      onClick={onClick}
    >
      <header className="flex justify-between items-center mb-2">
        <h3 className="text-xl font-semibold">
          {name} <span className="text-sm opacity-75">({symbol})</span>
        </h3>
        <span className={`font-bold ${trendClass}`}>
          {arrow} {Math.abs(surgePercent).toFixed(1)}%
        </span>
      </header>
      <p className="text-sm text-gray-500">As of {date}</p>
    </div>
  )
}
