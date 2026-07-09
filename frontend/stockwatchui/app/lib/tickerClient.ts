import type { Tick } from "./ticks";

// WebSocket client for the tick stream. Talks to the Python backend
// (backend/mock_ticker.py now, real KiteTicker-backed server later) with the
// same subscribe/on_ticks feel as KiteTicker itself.
//
//   const ticker = new TickerClient();
//   ticker.on_ticks((ticks) => ...);
//   ticker.connect();
//   ticker.subscribe([738561, 256265]);

const DEFAULT_URL = "ws://localhost:8765";

type TicksHandler = (ticks: Tick[]) => void;

// Instruments the mock backend knows about, for the search UI to match against.
export const INSTRUMENTS = [
  { instrument_token: 738561, symbol: "RELIANCE" },
  { instrument_token: 341249, symbol: "HDFCBANK" },
  { instrument_token: 408065, symbol: "INFY" },
  { instrument_token: 5633, symbol: "ACC" },
  { instrument_token: 256265, symbol: "NIFTY 50" },
];

export class TickerClient {
  private ws: WebSocket | null = null;
  private handler: TicksHandler | null = null;
  private subscribed = new Set<number>();

  constructor(private url: string = DEFAULT_URL) {}

  on_ticks(handler: TicksHandler): void {
    this.handler = handler;
  }

  connect(): void {
    if (this.ws) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      // (re)subscribe to anything requested before the socket was ready
      if (this.subscribed.size) this.send("subscribe", [...this.subscribed]);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "ticks" && this.handler) {
        this.handler(msg.data as Tick[]);
      }
    };
  }

  subscribe(tokens: number[]): void {
    for (const t of tokens) this.subscribed.add(t);
    this.send("subscribe", tokens);
  }

  unsubscribe(tokens: number[]): void {
    for (const t of tokens) this.subscribed.delete(t);
    this.send("unsubscribe", tokens);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  private send(action: string, tokens: number[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, tokens }));
    }
  }
}
