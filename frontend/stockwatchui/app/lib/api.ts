import type { Position } from "./holdings";

// Persistence API client -> FastAPI backend (backend/app.py).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
