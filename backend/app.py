"""StockWatch persistence API (FastAPI + MongoDB Atlas via motor).

Stores one portfolio document per user. Single-user for now: everything is
keyed to USER_ID = "default". Swap in real auth later by deriving the id from
a session/token instead of the constant.

Env:
  MONGODB_URI   Atlas SRV connection string (required)
  MONGODB_DB    database name (default: "stockwatch")

Run:  uvicorn backend.app:app --reload --port 8000
      (from the repo root, with the venv active)
"""

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

load_dotenv()

MONGODB_URI = os.environ.get("MONGODB_URI")
MONGODB_DB = os.environ.get("MONGODB_DB", "stockwatch")
USER_ID = "default"  # single-user placeholder

if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not set (see backend/.env.example)")


# --- schema (mirrors frontend Position in app/lib/holdings.ts) --------------
# Instruments are identified by their Yahoo symbol (e.g. "RELIANCE.NS").

class Lot(BaseModel):
    """One buy. Lots are the source of truth; quantity/average_price derive."""
    date: str  # ISO 8601 timestamp of the purchase
    price: float
    quantity: float


class Position(BaseModel):
    symbol: str  # Yahoo symbol, e.g. "RELIANCE.NS" -- the canonical id
    tradingsymbol: str  # display symbol, e.g. "RELIANCE"
    exchange: str  # "NSE" | "BSE"
    product: str
    lots: list[Lot] = Field(default_factory=list)
    quantity: float = 0  # derived from lots
    average_price: float = 0  # derived from lots
    realized_pnl: float = 0  # accumulated FIFO gain/loss from sells


class Portfolio(BaseModel):
    positions: list[Position] = Field(default_factory=list)


class SearchResult(BaseModel):
    symbol: str
    tradingsymbol: str
    exchange: str
    name: str


class TradeRequest(BaseModel):
    symbol: str
    tradingsymbol: str
    exchange: str
    product: str
    side: str  # "buy" | "sell"
    quantity: float = Field(gt=0)
    price: float = Field(ge=0)


# --- market hours -----------------------------------------------------------
# NSE/BSE regular equity session: 09:15-15:30 IST, Mon-Fri. Exchange holidays
# are not accounted for (would need a holiday calendar).

IST = ZoneInfo("Asia/Kolkata")
MARKET_OPEN = time(9, 15)
MARKET_CLOSE = time(15, 30)


def is_market_open(now: datetime | None = None) -> bool:
    now = now or datetime.now(IST)
    if now.weekday() >= 5:  # Saturday / Sunday
        return False
    return MARKET_OPEN <= now.time() <= MARKET_CLOSE


# --- app / db ---------------------------------------------------------------
# The Mongo client is created lazily on first use (not in a lifespan handler),
# so it works both under uvicorn locally and as a Vercel serverless function
# (where lifespan events don't run). Motor connects lazily, so building the
# client at import time is cheap.

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(MONGODB_URI)
    return _client


app = FastAPI(title="StockWatch API")

# Allow local dev and any Vercel deployment (preview + production) of the frontend.
_extra_origins = [
    o for o in os.environ.get("FRONTEND_ORIGINS", "").split(",") if o
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", *_extra_origins],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)


def portfolios():
    return get_client()[MONGODB_DB]["portfolios"]


# --- instrument search (Yahoo Finance) --------------------------------------
# NSE symbols end in ".NS" (Yahoo exchange "NSI"), BSE in ".BO" ("BSE").

_SUFFIX_TO_EXCHANGE = {"NS": "NSE", "BO": "BSE"}
_YAHOO_SEARCH = "https://query2.finance.yahoo.com/v1/finance/search"


def yahoo_search(query: str) -> list[SearchResult]:
    """Blocking: query Yahoo's symbol search, keep only NSE/BSE equities."""
    url = _YAHOO_SEARCH + "?" + urllib.parse.urlencode(
        {"q": query, "quotesCount": 20, "newsCount": 0}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.load(resp)

    results: list[SearchResult] = []
    for q in data.get("quotes", []):
        symbol = q.get("symbol", "")
        if q.get("quoteType") != "EQUITY" or "." not in symbol:
            continue
        base, suffix = symbol.rsplit(".", 1)
        exchange = _SUFFIX_TO_EXCHANGE.get(suffix)
        if not exchange:
            continue
        results.append(
            SearchResult(
                symbol=symbol,
                tradingsymbol=base,
                exchange=exchange,
                name=q.get("shortname") or q.get("longname") or base,
            )
        )
    return results


# --- live quotes (Yahoo v8 chart) -------------------------------------------
# Lightweight per-symbol quote (~0.13s, no auth). This is the polling
# replacement for the WebSocket ticker; the frontend calls /quotes on a timer.

_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1d&interval=1d"


def _round2(n):
    return round(n, 2) if n is not None else None


def yahoo_quote(symbol: str) -> dict | None:
    """Blocking: one quote from Yahoo's v8 chart endpoint -> tick dict."""
    req = urllib.request.Request(
        _CHART.format(symbol), headers={"User-Agent": "Mozilla/5.0"}
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        m = json.load(resp)["chart"]["result"][0]["meta"]

    is_index = symbol.startswith("^")
    if is_index:
        tradingsymbol, exchange = symbol, "INDEX"
    elif "." in symbol:
        base, suffix = symbol.rsplit(".", 1)
        tradingsymbol, exchange = base, _SUFFIX_TO_EXCHANGE.get(suffix, suffix)
    else:
        tradingsymbol, exchange = symbol, ""

    last = m.get("regularMarketPrice")
    prev_close = m.get("chartPreviousClose")
    change = (
        _round2((last - prev_close) / prev_close * 100)
        if last is not None and prev_close
        else 0.0
    )
    return {
        "symbol": symbol,
        "tradingsymbol": tradingsymbol,
        "exchange": exchange,
        "tradable": not is_index,
        "mode": "quote" if is_index else "full",
        "last_price": _round2(last),
        "change": change,
        "ohlc": {
            "open": None,
            "high": _round2(m.get("regularMarketDayHigh")),
            "low": _round2(m.get("regularMarketDayLow")),
            "close": _round2(prev_close),
        },
        "volume_traded": m.get("regularMarketVolume"),
        "exchange_timestamp": datetime.now(timezone.utc).isoformat(),
    }


# --- routes -----------------------------------------------------------------

@app.get("/quotes")
def quotes(symbols: str) -> list[dict]:
    """symbols = comma-separated Yahoo symbols, e.g. RELIANCE.NS,^NSEI."""
    out: list[dict] = []
    for sym in (s.strip() for s in symbols.split(",")):
        if not sym:
            continue
        try:
            q = yahoo_quote(sym)
            if q:
                out.append(q)
        except Exception:  # noqa: BLE001 -- skip a failed symbol, keep the rest
            continue
    return out


# Sync def -> FastAPI runs it in a threadpool, keeping the blocking HTTP call
# off the event loop.
@app.get("/search", response_model=list[SearchResult])
def search(q: str) -> list[SearchResult]:
    q = q.strip()
    if not q:
        return []
    try:
        return yahoo_search(q)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"search failed: {exc}")


@app.get("/market-status")
def market_status() -> dict:
    now = datetime.now(IST)
    return {
        "open": is_market_open(now),
        "now_ist": now.isoformat(),
        "session": "09:15-15:30 IST, Mon-Fri",
    }


@app.get("/health")
async def health() -> dict:
    try:
        await get_client().admin.command("ping")
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc))


# --- lot helpers ------------------------------------------------------------
# Lots are the source of truth; quantity/average_price are recomputed from them.

def _recompute(pos: dict) -> dict:
    lots = pos.get("lots", [])
    qty = sum(lot["quantity"] for lot in lots)
    cost = sum(lot["price"] * lot["quantity"] for lot in lots)
    pos["quantity"] = qty
    pos["average_price"] = cost / qty if qty else 0
    pos.setdefault("realized_pnl", 0)
    return pos


def _migrate(pos: dict) -> dict:
    """Back-fill a lot for legacy positions saved before lots existed."""
    if not pos.get("lots"):
        pos["lots"] = [
            {
                "date": datetime.now(IST).isoformat(),
                "price": pos.get("average_price", 0),
                "quantity": pos.get("quantity", 0),
            }
        ]
    return _recompute(pos)


async def _load_positions() -> list[dict]:
    doc = await portfolios().find_one({"_id": USER_ID})
    positions = doc.get("positions", []) if doc else []
    return [_migrate(p) for p in positions]


async def _save_positions(positions: list[dict]) -> None:
    await portfolios().update_one(
        {"_id": USER_ID}, {"$set": {"positions": positions}}, upsert=True
    )


@app.get("/holdings", response_model=Portfolio)
async def get_holdings() -> Portfolio:
    return Portfolio(positions=await _load_positions())


@app.put("/holdings", response_model=Portfolio)
async def put_holdings(portfolio: Portfolio) -> Portfolio:
    positions = [_migrate(p.model_dump()) for p in portfolio.positions]
    await _save_positions(positions)
    return Portfolio(positions=positions)


def _apply_trade(positions: list[dict], t: TradeRequest) -> list[dict]:
    """Apply a validated buy/sell. Buys append a lot; sells consume lots FIFO
    (oldest first) and accrue realized P&L. Guardrail: sell qty <= held."""
    idx = next(
        (i for i, p in enumerate(positions) if p["symbol"] == t.symbol), None
    )

    if t.side == "sell":
        held = positions[idx]["quantity"] if idx is not None else 0
        if t.quantity > held:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot sell {t.quantity:g}; only {held:g} held of {t.tradingsymbol}",
            )
        pos = positions[idx]
        remaining = t.quantity
        realized = 0.0
        kept: list[dict] = []
        for lot in pos["lots"]:  # oldest first
            if remaining <= 0:
                kept.append(lot)
                continue
            take = min(lot["quantity"], remaining)
            realized += (t.price - lot["price"]) * take
            lot["quantity"] -= take
            remaining -= take
            if lot["quantity"] > 0:
                kept.append(lot)
        pos["lots"] = kept
        pos["realized_pnl"] = pos.get("realized_pnl", 0) + realized
        if not kept:  # fully sold -> drop, but keep no dangling position
            positions.pop(idx)
        else:
            _recompute(pos)
        return positions

    # buy: append a new lot (or start a new position)
    new_lot = {
        "date": datetime.now(IST).isoformat(),
        "price": t.price,
        "quantity": t.quantity,
    }
    if idx is None:
        positions.append(
            _recompute(
                {
                    "symbol": t.symbol,
                    "tradingsymbol": t.tradingsymbol,
                    "exchange": t.exchange,
                    "product": t.product,
                    "lots": [new_lot],
                    "realized_pnl": 0,
                }
            )
        )
    else:
        positions[idx]["lots"].append(new_lot)
        _recompute(positions[idx])
    return positions


@app.post("/trade", response_model=Portfolio)
async def trade(req: TradeRequest) -> Portfolio:
    if req.side not in ("buy", "sell"):
        raise HTTPException(status_code=400, detail="side must be 'buy' or 'sell'")

    # Guardrail: no transactions outside market hours.
    if not is_market_open():
        raise HTTPException(
            status_code=409,
            detail="Market is closed (09:15-15:30 IST, Mon-Fri)",
        )

    positions = await _load_positions()
    positions = _apply_trade(positions, req)
    await _save_positions(positions)
    return Portfolio(positions=positions)
