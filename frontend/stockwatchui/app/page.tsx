"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { INSTRUMENTS, TickerClient } from "./lib/tickerClient";
import type { Tick } from "./lib/ticks";
import {
  SEED_POSITIONS,
  applyBuy,
  applySell,
  toHolding,
  type Position,
} from "./lib/holdings";
import { loadPositions, savePositions } from "./lib/api";
import PortfolioPane from "./components/PortfolioPane";
import TradeForm, { type TradeTarget } from "./components/TradeForm";

const DEFAULT_EXCHANGE = "NSE";
const DEFAULT_PRODUCT = "CNC";

export default function Home() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [ticks, setTicks] = useState<Record<number, Tick>>({});
  const [positions, setPositions] = useState<Position[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<TradeTarget | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Load the portfolio from MongoDB on mount; seed it on first-ever run.
  useEffect(() => {
    let cancelled = false;
    loadPositions()
      .then((stored) => {
        if (cancelled) return;
        setPositions(stored.length ? stored : SEED_POSITIONS);
      })
      .catch((err) => {
        console.error("failed to load holdings", err);
        if (!cancelled) setPositions(SEED_POSITIONS);
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to MongoDB whenever holdings change (after the initial load).
  useEffect(() => {
    if (!loaded) return;
    savePositions(positions).catch((err) =>
      console.error("failed to save holdings", err),
    );
  }, [positions, loaded]);

  // Live ticks for every instrument.
  useEffect(() => {
    const ticker = new TickerClient();
    ticker.on_ticks((incoming) => {
      setTicks((prev) => {
        const next = { ...prev };
        for (const t of incoming) next[t.instrument_token] = t;
        return next;
      });
    });
    ticker.connect();
    ticker.subscribe(INSTRUMENTS.map((i) => i.instrument_token));
    return () => ticker.disconnect();
  }, []);

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

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return INSTRUMENTS;
    return INSTRUMENTS.filter((i) => i.symbol.toLowerCase().includes(q));
  }, [query]);

  const holdings = useMemo(
    () => positions.map((p) => toHolding(p, ticks[p.instrument_token])),
    [positions, ticks],
  );

  const activePosition = target
    ? positions.find((p) => p.instrument_token === target.instrument_token)
    : undefined;

  function openFromSearch(inst: { instrument_token: number; symbol: string }) {
    // Prefer the exchange/product from an existing holding, else defaults.
    const held = positions.find((p) => p.instrument_token === inst.instrument_token);
    setTarget({
      instrument_token: inst.instrument_token,
      tradingsymbol: inst.symbol,
      exchange: held?.exchange ?? DEFAULT_EXCHANGE,
      product: held?.product ?? DEFAULT_PRODUCT,
    });
    setOpen(false);
    setQuery("");
  }

  function openFromHolding(token: number) {
    const p = positions.find((x) => x.instrument_token === token);
    if (!p) return;
    setTarget({
      instrument_token: p.instrument_token,
      tradingsymbol: p.tradingsymbol,
      exchange: p.exchange,
      product: p.product,
    });
  }

  function handleSubmit(side: "buy" | "sell", quantity: number) {
    if (!target) return;
    const price = ticks[target.instrument_token]?.last_price ?? 0;
    setPositions((prev) =>
      side === "buy"
        ? applyBuy(prev, target, quantity, price)
        : applySell(prev, target.instrument_token, quantity),
    );
    setTarget(null);
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
            placeholder="Search stocks..."
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-zinc-800 outline-none focus:border-zinc-500"
          />

          {open && (
            <ul className="absolute z-10 mt-2 max-h-80 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
              {matches.length === 0 ? (
                <li className="px-4 py-2 text-sm text-zinc-500">No matches</li>
              ) : (
                matches.map((inst) => {
                  const tick = ticks[inst.instrument_token];
                  const change = tick?.change ?? 0;
                  return (
                    <li
                      key={inst.instrument_token}
                      onClick={() => openFromSearch(inst)}
                      className="flex cursor-pointer items-center justify-between px-4 py-2 hover:bg-zinc-100"
                    >
                      <span className="font-medium text-zinc-800">
                        {inst.symbol}
                      </span>
                      <span className="flex items-baseline gap-2 tabular-nums">
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
          tick={ticks[target.instrument_token]}
          position={activePosition}
          onSubmit={handleSubmit}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
