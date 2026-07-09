"use client";

import { invested, type Holding } from "../lib/holdings";

interface Props {
  holdings: Holding[];
  onSelect: (symbol: string) => void;
}

function signClass(n: number): string {
  return n >= 0
    ? "text-green-600"
    : "text-red-600";
}

export default function PortfolioPane({ holdings, onSelect }: Props) {
  if (holdings.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-zinc-500">
        No holdings yet. Search a stock to buy.
      </p>
    );
  }

  const totalPnl = holdings.reduce((s, h) => s + h.pnl, 0);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between px-4 py-3 text-sm sm:px-6">
        <span className="font-medium text-zinc-800">
          Holdings <span className="text-zinc-400">{holdings.length}</span>
        </span>
        <span className={`tabular-nums font-medium ${signClass(totalPnl)}`}>
          P&L {totalPnl >= 0 ? "+" : ""}
          {totalPnl.toFixed(2)}
        </span>
      </div>

      <ul className="divide-y divide-zinc-100">
        {holdings.map((h) => (
          <li
            key={h.symbol}
            onClick={() => onSelect(h.symbol)}
            className="flex cursor-pointer items-center justify-between gap-3 px-4 py-4 hover:bg-zinc-50 sm:px-6"
          >
            {/* left: qty/avg + symbol */}
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-zinc-500 tabular-nums">
                {h.quantity} Qty. · Avg. {h.average_price.toFixed(2)}
              </span>
              <span className="truncate font-medium text-zinc-800">
                {h.tradingsymbol}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">
                Invested {invested(h).toFixed(2)}
              </span>
            </div>

            {/* right: pnl + ltp/change */}
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={`font-medium tabular-nums ${signClass(h.pnl)}`}>
                {h.pnl >= 0 ? "+" : ""}
                {h.pnl.toFixed(2)}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">
                LTP {h.last_price.toFixed(2)}{" "}
                <span className={signClass(h.day_change_percentage)}>
                  ({h.day_change_percentage >= 0 ? "+" : ""}
                  {h.day_change_percentage.toFixed(2)}%)
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
