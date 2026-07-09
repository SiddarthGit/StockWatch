"use client";

import { useEffect, useState } from "react";
import type { Tick } from "../lib/ticks";
import type { Position } from "../lib/holdings";

export interface TradeTarget {
  symbol: string; // Yahoo symbol, e.g. "RELIANCE.NS"
  tradingsymbol: string;
  exchange: string;
  product: string;
}

interface Props {
  target: TradeTarget;
  tick?: Tick;
  position?: Position; // existing holding, if any
  marketOpen?: boolean | null; // null = unknown/loading
  error?: string | null; // server-side rejection message
  onSubmit: (side: "buy" | "sell", quantity: number) => void;
  onClose: () => void;
}

export default function TradeForm({
  target,
  tick,
  position,
  marketOpen,
  error,
  onSubmit,
  onClose,
}: Props) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState(1);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const price = tick?.last_price ?? position?.average_price ?? 0;
  const change = tick?.change ?? 0;
  const up = change >= 0;
  const total = price * quantity;
  const held = position?.quantity ?? 0;
  const canSell = held > 0;

  // Guardrails: block outside market hours; a sell can't exceed the holding.
  const closed = marketOpen === false;
  const oversell = side === "sell" && quantity > held;
  const canSubmit = !closed && quantity > 0 && !(side === "sell" && oversell);

  return (
    // translucent backdrop
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
      >
        {/* header: symbol + live price */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-800">
              {target.tradingsymbol}
            </h2>
            <p className="text-xs text-zinc-500">
              {target.exchange} · {target.product}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums text-zinc-800">
              ₹{price.toFixed(2)}
            </div>
            <div
              className={
                up
                  ? "text-sm tabular-nums text-green-600"
                  : "text-sm tabular-nums text-red-600"
              }
            >
              {up ? "▲" : "▼"} {up ? "+" : ""}
              {change.toFixed(2)}%
            </div>
          </div>
        </div>

        {position && (
          <p className="mt-2 text-xs text-zinc-500">
            Held: {position.quantity} @ ₹{position.average_price.toFixed(2)}
          </p>
        )}

        {closed && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Market is closed (09:15–15:30 IST, Mon–Fri). Trading is disabled.
          </div>
        )}

        {/* buy / sell toggle */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setSide("buy")}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              side === "buy"
                ? "bg-green-600 text-white"
                : "bg-zinc-100 text-zinc-600"
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => canSell && setSide("sell")}
            disabled={!canSell}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              side === "sell"
                ? "bg-red-600 text-white"
                : "bg-zinc-100 text-zinc-600 disabled:opacity-40"
            }`}
          >
            Sell
          </button>
        </div>

        {/* quantity */}
        <label className="mt-4 block text-xs text-zinc-500">Quantity</label>
        <input
          type="number"
          min={1}
          max={side === "sell" ? held : undefined}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base tabular-nums text-zinc-800 outline-none focus:border-zinc-500"
        />
        {oversell && (
          <p className="mt-1 text-xs text-red-600">
            You can sell at most {held} share{held === 1 ? "" : "s"}.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-zinc-500">Approx. value</span>
          <span className="font-medium tabular-nums text-zinc-800">
            ₹{total.toFixed(2)}
          </span>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {/* actions */}
        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-300 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onSubmit(side, quantity)}
            disabled={!canSubmit}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              side === "buy"
                ? "bg-green-600 hover:bg-green-700"
                : "bg-red-600 hover:bg-red-700"
            }`}
          >
            {closed ? "Market closed" : `${side === "buy" ? "Buy" : "Sell"} ${quantity}`}
          </button>
        </div>
      </div>
    </div>
  );
}
