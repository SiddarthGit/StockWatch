"""Real market-data ticker backed by Yahoo Finance.

Drop-in for the frontend WebSocket protocol (app/lib/tickerClient.ts).
Instruments are identified by their Yahoo symbol (e.g. "RELIANCE.NS", "TCS.BO",
"^NSEI"); any NSE (.NS) / BSE (.BO) equity can be subscribed.

  client -> {"action": "subscribe",   "symbols": ["RELIANCE.NS", "^NSEI"]}
  client -> {"action": "unsubscribe", "symbols": ["RELIANCE.NS"]}
  server -> {"type": "ticks", "data": [ <tick>, ... ]}

Prices come from Yahoo's lightweight v8 chart endpoint (~0.13s/symbol, no auth).
Yahoo throttles bursts to ~1 req/s, so we fetch sequentially and push each tick
as it arrives -- newly subscribed symbols are fetched FIRST so a freshly
searched ticker shows its price within a second or two rather than a dash.

Data is delayed ~15 min and holds at last close outside market hours.

Run:  python backend/yfinance_ticker.py   (ws://localhost:8765)
"""

import asyncio
import json
import urllib.request
from datetime import datetime, timezone

import websockets

POLL_SECONDS = 5
_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1d&interval=1d"
_SUFFIX_TO_EXCHANGE = {"NS": "NSE", "BO": "BSE"}


def _round2(n):
    return round(n, 2) if n is not None else None


def _meta(symbol: str):
    """Derive (tradingsymbol, exchange, is_index) from a Yahoo symbol."""
    if symbol.startswith("^"):
        return symbol, "INDEX", True
    if "." in symbol:
        base, suffix = symbol.rsplit(".", 1)
        return base, _SUFFIX_TO_EXCHANGE.get(suffix, suffix), False
    return symbol, "", False


def quote(symbol: str):
    """Blocking: fetch one quote from Yahoo's v8 chart endpoint -> tick dict."""
    req = urllib.request.Request(
        _CHART.format(symbol), headers={"User-Agent": "Mozilla/5.0"}
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        m = json.load(resp)["chart"]["result"][0]["meta"]

    tradingsymbol, exchange, is_index = _meta(symbol)
    last = m.get("regularMarketPrice")
    prev_close = m.get("chartPreviousClose")
    change = (
        _round2((last - prev_close) / prev_close * 100)
        if last is not None and prev_close
        else 0.0
    )
    tick = {
        "symbol": symbol,
        "tradingsymbol": tradingsymbol,
        "exchange": exchange,
        "last_price": _round2(last),
        "ohlc": {
            "open": None,
            "high": _round2(m.get("regularMarketDayHigh")),
            "low": _round2(m.get("regularMarketDayLow")),
            "close": _round2(prev_close),
        },
        "change": change,
        "exchange_timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if is_index:
        return {**tick, "tradable": False, "mode": "quote"}
    return {
        **tick,
        "tradable": True,
        "mode": "full",
        "volume_traded": m.get("regularMarketVolume"),
        "last_trade_time": tick["exchange_timestamp"],
    }


async def stream(ws):
    subscribed = set()
    fetched = set()  # symbols already priced at least once
    wake = asyncio.Event()
    print("client connected")

    async def reader():
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            action, symbols = msg.get("action"), msg.get("symbols", [])
            if action == "subscribe":
                subscribed.update(symbols)
                wake.set()  # fetch the new symbols right away
            elif action == "unsubscribe":
                subscribed.difference_update(symbols)
                fetched.difference_update(symbols)

    async def writer():
        while True:
            # newly subscribed symbols first, so their price appears fast
            order = [s for s in subscribed if s not in fetched] + [
                s for s in subscribed if s in fetched
            ]
            for sym in order:
                if sym not in subscribed:
                    continue
                try:
                    tick = await asyncio.to_thread(quote, sym)
                    fetched.add(sym)
                    await ws.send(json.dumps({"type": "ticks", "data": [tick]}))
                except Exception as exc:  # noqa: BLE001
                    print(f"quote failed for {sym}: {exc}")
            # sleep until the next poll, or wake early on a new subscription
            wake.clear()
            try:
                await asyncio.wait_for(wake.wait(), timeout=POLL_SECONDS)
            except asyncio.TimeoutError:
                pass

    try:
        await asyncio.gather(reader(), writer())
    except websockets.ConnectionClosed:
        print("client disconnected")


async def main():
    async with websockets.serve(stream, "localhost", 8765):
        print("yfinance ticker on ws://localhost:8765")
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
