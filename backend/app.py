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

import os
from contextlib import asynccontextmanager

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

class Position(BaseModel):
    tradingsymbol: str
    exchange: str
    instrument_token: int
    product: str
    quantity: float
    average_price: float


class Portfolio(BaseModel):
    positions: list[Position] = Field(default_factory=list)


# --- app / db ---------------------------------------------------------------

client: AsyncIOMotorClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global client
    client = AsyncIOMotorClient(MONGODB_URI)
    # fail fast if Atlas is unreachable / credentials are wrong
    await client.admin.command("ping")
    yield
    client.close()


app = FastAPI(title="StockWatch API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def portfolios():
    assert client is not None
    return client[MONGODB_DB]["portfolios"]


# --- routes -----------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    try:
        assert client is not None
        await client.admin.command("ping")
        return {"ok": True}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/holdings", response_model=Portfolio)
async def get_holdings() -> Portfolio:
    doc = await portfolios().find_one({"_id": USER_ID})
    if not doc:
        return Portfolio(positions=[])
    return Portfolio(positions=doc.get("positions", []))


@app.put("/holdings", response_model=Portfolio)
async def put_holdings(portfolio: Portfolio) -> Portfolio:
    await portfolios().update_one(
        {"_id": USER_ID},
        {"$set": {"positions": [p.model_dump() for p in portfolio.positions]}},
        upsert=True,
    )
    return portfolio
