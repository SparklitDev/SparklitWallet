import React from 'react'

interface Whale {
  address: string
  amount: number
}

interface WhaleWatcherPanelProps {
  whales: Whale[]
  periodHours: number
}

export const WhaleWatcherPanel: React.FC<WhaleWatcherPanelProps> = ({
  whales,
  periodHours,
}) => {
  return (
    <div className="border rounded-2xl p-4 shadow-md">
      <h2 className="text-lg font-medium mb-3">
        Top Wallets in Last {periodHours}h
      </h2>
      <ul className="space-y-2 max-h-60 overflow-y-auto">
        {whales.map((w, i) => (
          <li
            key={w.address}
            className="flex justify-between items-center px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100"
          >
            <span className="font-mono truncate">{w.address}</span>
            <span className="font-semibold">
              {w.amount.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
