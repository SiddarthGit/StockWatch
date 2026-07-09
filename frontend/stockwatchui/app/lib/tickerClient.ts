import type { Tick } from "./ticks";

// WebSocket client for the tick stream. Talks to the Python backend
// (backend/yfinance_ticker.py) with a KiteTicker-like subscribe/on_ticks feel.
// Instruments are identified by their Yahoo symbol, e.g. "RELIANCE.NS".
//
//   const ticker = new TickerClient();
//   ticker.on_ticks((ticks) => ...);
//   ticker.connect();
//   ticker.subscribe(["RELIANCE.NS", "^NSEI"]);

const DEFAULT_URL =
  process.env.NEXT_PUBLIC_TICKER_URL ?? "ws://localhost:8765";

type TicksHandler = (ticks: Tick[]) => void;

export class TickerClient {
  private ws: WebSocket | null = null;
  private handler: TicksHandler | null = null;
  private subscribed = new Set<string>();

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

  subscribe(symbols: string[]): void {
    for (const s of symbols) this.subscribed.add(s);
    this.send("subscribe", symbols);
  }

  unsubscribe(symbols: string[]): void {
    for (const s of symbols) this.subscribed.delete(s);
    this.send("unsubscribe", symbols);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  private send(action: string, symbols: string[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, symbols }));
    }
  }
}
