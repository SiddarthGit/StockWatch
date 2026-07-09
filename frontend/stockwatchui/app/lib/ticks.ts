// Parsed tick shape, matching what KiteTicker's `on_ticks` callback delivers
// (pykiteconnect v4). Prices here are already converted to rupees.
// https://kite.trade/docs/pykiteconnect/v4/#kiteconnect.KiteTicker

export type TickMode = "ltp" | "quote" | "full";

export interface DepthEntry {
  quantity: number;
  price: number;
  orders: number;
}

export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Tick {
  tradable: boolean;
  mode: TickMode;
  symbol: string; // Yahoo symbol, e.g. "RELIANCE.NS" -- the canonical id
  tradingsymbol?: string; // display symbol, e.g. "RELIANCE"
  exchange?: string; // "NSE" | "BSE" | "INDEX"

  // ltp mode and up
  last_price: number;

  // quote mode and up
  last_traded_quantity?: number;
  average_traded_price?: number;
  volume_traded?: number;
  total_buy_quantity?: number;
  total_sell_quantity?: number;
  ohlc?: OHLC;
  change?: number;

  // full mode. Timestamps arrive as ISO 8601 strings over the wire.
  last_trade_time?: string;
  oi?: number;
  oi_day_high?: number;
  oi_day_low?: number;
  exchange_timestamp?: string;
  depth?: {
    buy: DepthEntry[];
    sell: DepthEntry[];
  };
}
