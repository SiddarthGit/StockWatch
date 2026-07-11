import type { Tick } from "./ticks";

// Polls the backend /quotes endpoint on a timer and delivers ticks, exposing
// the same subscribe/on_ticks/connect/disconnect surface the old WebSocket
// client had -- so the rest of the app is unchanged. Polling (rather than a
// WebSocket) is what lets the whole backend run as Vercel serverless functions.
//
//   const ticker = new TickerClient();
//   ticker.on_ticks((ticks) => ...);
//   ticker.connect();
//   ticker.subscribe(["RELIANCE.NS", "^NSEI"]);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const POLL_MS = 4000;

type TicksHandler = (ticks: Tick[]) => void;

export class TickerClient {
  private handler: TicksHandler | null = null;
  private subscribed = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(private intervalMs: number = POLL_MS) {}

  on_ticks(handler: TicksHandler): void {
    this.handler = handler;
  }

  connect(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  subscribe(symbols: string[]): void {
    let added = false;
    for (const s of symbols) {
      if (!this.subscribed.has(s)) {
        this.subscribed.add(s);
        added = true;
      }
    }
    if (added) this.poll(); // fetch new symbols right away
  }

  unsubscribe(symbols: string[]): void {
    for (const s of symbols) this.subscribed.delete(s);
  }

  disconnect(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.inFlight || this.subscribed.size === 0 || !this.handler) return;
    this.inFlight = true;
    try {
      const symbols = [...this.subscribed].join(",");
      const res = await fetch(
        `${API_URL}/quotes?symbols=${encodeURIComponent(symbols)}`,
      );
      if (!res.ok) return;
      const ticks = (await res.json()) as Tick[];
      if (ticks.length) this.handler(ticks);
    } catch {
      // transient network error; next tick will retry
    } finally {
      this.inFlight = false;
    }
  }
}
