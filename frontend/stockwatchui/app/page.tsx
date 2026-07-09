"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TickerClient } from "./lib/tickerClient";
import type { Tick } from "./lib/ticks";
import { toHolding, type Position } from "./lib/holdings";
import {
  getMarketStatus,
  loadPositions,
  searchInstruments,
  trade,
  type SearchResult,
} from "./lib/api";
import PortfolioPane from "./components/PortfolioPane";
import TradeForm, { type TradeTarget } from "./components/TradeForm";

const DEFAULT_PRODUCT = "CNC";

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const [positions, setPositions] = useState<Position[]>([]);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [target, setTarget] = useState<TradeTarget | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const tickerRef = useRef<TickerClient | null>(null);

  // One ticker for the whole page; merge incoming ticks by symbol.
  useEffect(() => {
    const ticker = new TickerClient();
    tickerRef.current = ticker;
    ticker.on_ticks((incoming) => {
      setTicks((prev) => {
        const next = { ...prev };
        for (const t of incoming) next[t.symbol] = t;
        return next;
      });
    });
    ticker.connect();
    return () => {
      ticker.disconnect();
      tickerRef.current = null;
    };
  }, []);

  // Load portfolio from MongoDB on mount and subscribe to held symbols.
  // (Trades are persisted server-side via /trade, so no save-on-change here.)
  useEffect(() => {
    let cancelled = false;
    loadPositions()
      .then((stored) => {
        if (cancelled) return;
        setPositions(stored);
        tickerRef.current?.subscribe(stored.map((p) => p.symbol));
      })
      .catch((err) => console.error("failed to load holdings", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Track market open/closed; refresh every minute.
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      getMarketStatus()
        .then((s) => !cancelled && setMarketOpen(s.open))
        .catch((err) => console.error("market status failed", err));
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Debounced instrument search against the backend (Yahoo -> NSE/BSE).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const id = setTimeout(() => {
      searchInstruments(q, controller.signal)
        .then((res) => {
          setResults(res);
          // subscribe so the dropdown can show live prices
          tickerRef.current?.subscribe(res.map((r) => r.symbol));
        })
        .catch((err) => {
          if (err.name !== "AbortError") console.error("search failed", err);
        });
    }, 250);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [query]);

  // Close dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const holdings = useMemo(
    () => positions.map((p) => toHolding(p, ticks[p.symbol])),
    [positions, ticks],
  );

  const activePosition = target
    ? positions.find((p) => p.symbol === target.symbol)
    : undefined;

  function openFromSearch(r: SearchResult) {
    tickerRef.current?.subscribe([r.symbol]);
    const held = positions.find((p) => p.symbol === r.symbol);
    setFormError(null);
    setTarget({
      symbol: r.symbol,
      tradingsymbol: r.tradingsymbol,
      exchange: r.exchange,
      product: held?.product ?? DEFAULT_PRODUCT,
    });
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  function openFromHolding(symbol: string) {
    const p = positions.find((x) => x.symbol === symbol);
    if (!p) return;
    setFormError(null);
    setTarget({
      symbol: p.symbol,
      tradingsymbol: p.tradingsymbol,
      exchange: p.exchange,
      product: p.product,
    });
  }

  // Execute the trade server-side (backend enforces market hours + sell limit).
  async function handleSubmit(side: "buy" | "sell", quantity: number) {
    if (!target) return;
    setFormError(null);
    try {
      const updated = await trade({
        symbol: target.symbol,
        tradingsymbol: target.tradingsymbol,
        exchange: target.exchange,
        product: target.product,
        side,
        quantity,
        price: ticks[target.symbol]?.last_price ?? 0,
      });
      setPositions(updated);
      setTarget(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Trade failed");
    }
  }

  return (
    <div className="flex flex-col flex-1 font-sans">
      <header className="flex w-full items-center justify-between gap-4 px-6 py-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-800">
          StockWatch
        </h1>

        <div ref={boxRef} className="relative w-full max-w-md">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search NSE & BSE stocks..."
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-zinc-800 outline-none focus:border-zinc-500"
          />

          {open && query.trim() && (
            <ul className="absolute z-10 mt-2 max-h-80 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
              {results.length === 0 ? (
                <li className="px-4 py-2 text-sm text-zinc-500">No matches</li>
              ) : (
                results.map((r) => {
                  const tick = ticks[r.symbol];
                  const change = tick?.change ?? 0;
                  return (
                    <li
                      key={r.symbol}
                      onClick={() => openFromSearch(r)}
                      className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2 hover:bg-zinc-100"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-zinc-800">
                          {r.tradingsymbol}
                          <span className="ml-2 text-xs font-normal text-zinc-400">
                            {r.exchange}
                          </span>
                        </span>
                        <span className="truncate text-xs text-zinc-500">
                          {r.name}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                        <span className="text-zinc-800">
                          {tick ? `₹${tick.last_price.toFixed(2)}` : "—"}
                        </span>
                        {tick && (
                          <span
                            className={
                              change >= 0
                                ? "text-sm text-green-600"
                                : "text-sm text-red-600"
                            }
                          >
                            {change >= 0 ? "+" : ""}
                            {change.toFixed(2)}%
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      </header>

      {/* portfolio pane below the search bar */}
      <main className="flex-1">
        <PortfolioPane holdings={holdings} onSelect={openFromHolding} />
      </main>

      {target && (
        <TradeForm
          target={target}
          tick={ticks[target.symbol]}
          position={activePosition}
          marketOpen={marketOpen}
          error={formError}
          onSubmit={handleSubmit}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
