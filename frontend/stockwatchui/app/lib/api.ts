import type { Position } from "./holdings";

// Persistence + search API client -> FastAPI backend (backend/app.py).
// Trailing slashes are stripped so `${API_URL}/path` never becomes `//path`.
const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

export interface SearchResult {
  symbol: string; // Yahoo symbol, e.g. "RELIANCE.NS"
  tradingsymbol: string; // display, e.g. "RELIANCE"
  exchange: string; // "NSE" | "BSE"
  name: string;
}

export async function searchInstruments(
  q: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(q)}`, {
    signal,
  });
  if (!res.ok) throw new Error(`GET /search failed: ${res.status}`);
  return (await res.json()) as SearchResult[];
}

export interface MarketStatus {
  open: boolean;
  now_ist: string;
  session: string;
}

export async function getMarketStatus(): Promise<MarketStatus> {
  const res = await fetch(`${API_URL}/market-status`);
  if (!res.ok) throw new Error(`GET /market-status failed: ${res.status}`);
  return (await res.json()) as MarketStatus;
}

export interface TradeRequest {
  symbol: string;
  tradingsymbol: string;
  exchange: string;
  product: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
}

// Executes a trade server-side (validates market hours + sell <= holding).
// Returns the updated positions; throws Error(message) on a rejected trade.
export async function trade(req: TradeRequest): Promise<Position[]> {
  const res = await fetch(`${API_URL}/trade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail ?? `trade failed: ${res.status}`);
  }
  return (data as { positions: Position[] }).positions;
}

export async function loadPositions(): Promise<Position[]> {
  const res = await fetch(`${API_URL}/holdings`);
  if (!res.ok) throw new Error(`GET /holdings failed: ${res.status}`);
  const data = (await res.json()) as { positions: Position[] };
  return data.positions;
}

export async function savePositions(positions: Position[]): Promise<void> {
  const res = await fetch(`${API_URL}/holdings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positions }),
  });
  if (!res.ok) throw new Error(`PUT /holdings failed: ${res.status}`);
}
