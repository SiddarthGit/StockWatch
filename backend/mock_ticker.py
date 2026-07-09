"""Mock KiteTicker WebSocket server.

Streams randomly-walking ticks in the SAME parsed shape that
pykiteconnect's KiteTicker.on_ticks() delivers, serialized to JSON.
Timestamps go out as ISO 8601 strings (JSON has no datetime).

Later, replace `mock_tick()` / the emit loop with a real KiteTicker whose
on_ticks callback forwards `ticks` to connected clients -- the wire format
stays identical, so the frontend needs no changes.

Run:  python backend/mock_ticker.py   (listens on ws://localhost:8765)

Protocol:
  client -> {"action": "subscribe",   "tokens": [738561, 256265]}
  client -> {"action": "unsubscribe", "tokens": [738561]}
  server -> {"type": "ticks", "data": [ <tick>, ... ]}   ~1/sec
"""

import asyncio
import json
import random
from datetime import datetime, timezone

import websockets

# --- sample instruments (fake tokens/prices) --------------------------------

SEED = [
    {"instrument_token": 738561, "symbol": "RELIANCE", "last_price": 2950.50, "index": False},
    {"instrument_token": 341249, "symbol": "HDFCBANK", "last_price": 1685.25, "index": False},
    {"instrument_token": 408065, "symbol": "INFY",     "last_price": 1620.80, "index": False},
    {"instrument_token": 5633,   "symbol": "ACC",      "last_price": 2480.00, "index": False},
    {"instrument_token": 256265, "symbol": "NIFTY 50", "last_price": 24350.35, "index": True},
]
SEED_BY_TOKEN = {s["instrument_token"]: s for s in SEED}

# live prices, mutated by the random walk
_prices = {s["instrument_token"]: s["last_price"] for s in SEED}


def _round2(n):
    return round(n, 2)


def mock_tick(seed, price):
    """Build one parsed tick matching KiteTicker's on_ticks payload."""
    now = datetime.now(timezone.utc).isoformat()
    open_ = seed["last_price"]
    ohlc = {
        "open": open_,
        "high": _round2(max(open_, price) * 1.002),
        "low": _round2(min(open_, price) * 0.998),
        "close": open_,
    }
    change = _round2((price - open_) / open_ * 100)

    # Indices carry fewer fields on the wire (ltp/ohlc/change only).
    if seed["index"]:
        return {
            "tradable": False,
            "mode": "quote",
            "instrument_token": seed["instrument_token"],
            "last_price": price,
            "ohlc": ohlc,
            "change": change,
            "exchange_timestamp": now,
        }

    return {
        "tradable": True,
        "mode": "full",
        "instrument_token": seed["instrument_token"],
        "last_price": price,
        "last_traded_quantity": random.randint(1, 500),
        "average_traded_price": _round2((ohlc["high"] + ohlc["low"]) / 2),
        "volume_traded": random.randint(0, 1_000_000),
        "total_buy_quantity": random.randint(0, 100_000),
        "total_sell_quantity": random.randint(0, 100_000),
        "ohlc": ohlc,
        "change": change,
        "last_trade_time": now,
        "oi": 0,
        "oi_day_high": 0,
        "oi_day_low": 0,
        "exchange_timestamp": now,
        "depth": {
            "buy": [
                {
                    "quantity": random.randint(0, 1000),
                    "price": _round2(price - (i + 1) * 0.05),
                    "orders": random.randint(0, 20),
                }
                for i in range(5)
            ],
            "sell": [
                {
                    "quantity": random.randint(0, 1000),
                    "price": _round2(price + (i + 1) * 0.05),
                    "orders": random.randint(0, 20),
                }
                for i in range(5)
            ],
        },
    }


async def stream(ws):
    """Handle one client: track its subscriptions, push ticks ~1/sec."""
    subscribed = set()
    print("client connected")

    async def reader():
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            action, tokens = msg.get("action"), msg.get("tokens", [])
            if action == "subscribe":
                subscribed.update(t for t in tokens if t in SEED_BY_TOKEN)
            elif action == "unsubscribe":
                subscribed.difference_update(tokens)

    async def writer():
        while True:
            await asyncio.sleep(1)
            ticks = []
            for token in list(subscribed):
                seed = SEED_BY_TOKEN[token]
                prev = _prices[token]
                nxt = _round2(prev * (1 + (random.random() - 0.5) * 0.005))
                _prices[token] = nxt
                ticks.append(mock_tick(seed, nxt))
            if ticks:
                await ws.send(json.dumps({"type": "ticks", "data": ticks}))

    try:
        await asyncio.gather(reader(), writer())
    except websockets.ConnectionClosed:
        print("client disconnected")


async def main():
    async with websockets.serve(stream, "localhost", 8765):
        print("mock ticker on ws://localhost:8765")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
