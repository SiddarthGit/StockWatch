import type { Tick } from "./ticks";

// A held position -- the minimal state we persist. Instruments are identified
// by their Yahoo symbol (e.g. "RELIANCE.NS"). Everything the Kite holdings()
// response exposes (pnl, day_change...) is derived from this + the live tick.
// One buy. Lots are the source of truth; quantity/average_price derive.
export interface Lot {
  date: string; // ISO 8601 timestamp of the purchase
  price: number;
  quantity: number;
}

export interface Position {
  symbol: string; // Yahoo symbol, e.g. "RELIANCE.NS" -- the canonical id
  tradingsymbol: string; // display symbol, e.g. "RELIANCE"
  exchange: string; // "NSE" | "BSE"
  product: string; // e.g. "CNC"
  lots: Lot[];
  quantity: number; // derived from lots
  average_price: number; // derived from lots
  realized_pnl?: number; // accumulated FIFO gain/loss from sells
}

// The shape Kite Connect's holdings() returns per instrument (the fields we use).
export interface Holding extends Position {
  last_price: number;
  close_price: number;
  pnl: number;
  day_change: number;
  day_change_percentage: number;
}

export function invested(p: Position): number {
  return p.average_price * p.quantity;
}

// Derive a full holding row from a position + its latest tick.
export function toHolding(p: Position, tick?: Tick): Holding {
  const last_price = tick?.last_price ?? p.average_price;
  const close_price = tick?.ohlc?.close ?? last_price;
  const day_change = last_price - close_price;
  return {
    ...p,
    last_price,
    close_price,
    pnl: (last_price - p.average_price) * p.quantity,
    day_change,
    day_change_percentage: tick?.change ?? 0,
  };
}

// NOTE: buy/sell math lives on the backend (POST /trade) so the guardrails
// (market hours, sell <= holding) can't be bypassed from the client.
