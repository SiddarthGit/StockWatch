import type { Tick } from "./ticks";

// A held position -- the minimal state we persist. Everything the Kite
// holdings() response exposes (pnl, day_change, last_price...) is *derived*
// from this plus the live tick, see toHolding().
export interface Position {
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  product: string; // e.g. "CNC"
  quantity: number;
  average_price: number;
}

// The shape Kite Connect's holdings() returns per instrument (the fields we use).
export interface Holding {
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  product: string;
  quantity: number;
  average_price: number;
  last_price: number;
  close_price: number;
  pnl: number;
  day_change: number;
  day_change_percentage: number;
}

// Seed portfolio so the pane isn't empty on first load.
export const SEED_POSITIONS: Position[] = [
  { tradingsymbol: "RELIANCE", exchange: "NSE", instrument_token: 738561, product: "CNC", quantity: 5, average_price: 2900.0 },
  { tradingsymbol: "INFY", exchange: "NSE", instrument_token: 408065, product: "CNC", quantity: 10, average_price: 1500.0 },
];

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

// Apply a buy: merge into an existing position (weighted-average price) or add.
export function applyBuy(
  positions: Position[],
  order: { instrument_token: number; tradingsymbol: string; exchange: string; product: string },
  quantity: number,
  price: number,
): Position[] {
  const idx = positions.findIndex((p) => p.instrument_token === order.instrument_token);
  if (idx === -1) {
    return [...positions, { ...order, quantity, average_price: price }];
  }
  const next = [...positions];
  const cur = next[idx];
  const totalQty = cur.quantity + quantity;
  next[idx] = {
    ...cur,
    quantity: totalQty,
    average_price: (invested(cur) + price * quantity) / totalQty,
  };
  return next;
}

// Apply a sell: reduce quantity, dropping the position if it hits zero.
export function applySell(
  positions: Position[],
  instrument_token: number,
  quantity: number,
): Position[] {
  const idx = positions.findIndex((p) => p.instrument_token === instrument_token);
  if (idx === -1) return positions;
  const remaining = positions[idx].quantity - quantity;
  if (remaining <= 0) return positions.filter((_, i) => i !== idx);
  const next = [...positions];
  next[idx] = { ...next[idx], quantity: remaining };
  return next;
}
