import React, { useMemo, useState } from "react"

interface Whale {
  address: string
  amount: number
}

interface WhaleWatcherPanelProps {
  whales: Whale[]
  periodHours: number
}

/**
 * Enhanced WhaleWatcherPanel
 * - Sorts by amount desc (stable)
 * - Search by address
 * - Copy-to-clipboard for addresses with feedback
 * - Relative bars to visualize amounts
 * - Totals + empty state
 * - "Show more" for long lists
 */
export const WhaleWatcherPanel: React.FC<WhaleWatcherPanelProps> = ({
  whales,
  periodHours,
}) => {
  const [query, setQuery] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Derived data
  const sorted = useMemo(() => {
    // stable sort: copy then sort
    return [...whales].sort((a, b) => {
      if (b.amount === a.amount) return a.address.localeCompare(b.address)
      return b.amount - a.amount
    })
  }, [whales])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(w => w.address.toLowerCase().includes(q))
  }, [sorted, query])

  const maxAmount = useMemo(
    () => Math.max(1, ...filtered.map(w => Math.abs(w.amount))),
    [filtered]
  )

  const total = useMemo(
    () => filtered.reduce((s, w) => s + (Number.isFinite(w.amount) ? w.amount : 0), 0),
    [filtered]
  )

  const visible = useMemo(() => {
    const DEFAULT_LIMIT = 10
    return expanded ? filtered : filtered.slice(0, DEFAULT_LIMIT)
  }, [filtered, expanded])

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)

  const short = (addr: string, left = 6, right = 6) =>
    addr.length > left + right + 3
      ? `${addr.slice(0, left)}…${addr.slice(-right)}`
      : addr

  const copy = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr)
      setCopied(addr)
      setTimeout(() => setCopied(null), 1200)
    } catch {
      // noop
    }
  }

  return (
    <div className="border rounded-2xl p-4 shadow-md bg-white">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            Top Wallets in Last {periodHours}h
          </h2>
          <p className="text-xs text-gray-500">
            {filtered.length} wallet{filtered.length === 1 ? "" : "s"} • Total:{" "}
            <span className="font-medium">{fmt(total)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search address…"
            className="w-full sm:w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-300"
            aria-label="Search wallet address"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
          No whale activity for the selected period.
        </div>
      ) : (
        <>
          <ul className="mt-3 space-y-2 max-h-80 overflow-y-auto" role="list">
            {visible.map((w, i) => {
              const rank = i + 1
              const pct = Math.max(2, Math.round((Math.abs(w.amount) / maxAmount) * 100))
              const isCopied = copied === w.address
              return (
                <li
                  key={w.address}
                  role="listitem"
                  className="relative overflow-hidden rounded-lg border bg-gray-50 hover:bg-gray-100"
                >
                  {/* bar */}
                  <div
                    className="absolute inset-y-0 left-0 bg-gray-200"
                    style={{ width: `${pct}%` }}
                    aria-hidden="true"
                  />
                  <div className="relative z-10 flex items-center justify-between gap-3 px-3 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-xs font-semibold text-gray-700 border">
                        {rank}
                      </span>
                      <code className="font-mono text-sm truncate">
                        {short(w.address)}
                      </code>
                      <button
                        onClick={() => copy(w.address)}
                        className="ml-1 rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-white"
                        aria-label={`Copy address ${w.address}`}
                        title="Copy address"
                      >
                        {isCopied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <span className="font-semibold tabular-nums">
                      {fmt(w.amount)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          {filtered.length > visible.length && (
            <div className="mt-3 text-center">
              <button
                onClick={() => setExpanded(s => !s)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                {expanded
                  ? "Show less"
                  : `Show all ${filtered.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
