"use client";

import type { Lot } from "../lib/holdings";

// A compact "your buys" scatter: each purchase is a dot (date -> price), sized
// by quantity, coloured green/red by whether that lot is currently up or down.
// A dashed line marks the weighted-average cost, a solid line the live price.
// Single entity -> no legend; the two reference lines are directly labelled.

interface Props {
  lots: Lot[];
  averagePrice: number;
  currentPrice: number;
}

const W = 320;
const H = 168;
const PAD = { top: 14, right: 52, bottom: 22, left: 44 };

const INK = "#27272a"; // zinc-800
const MUTED = "#a1a1aa"; // zinc-400
const GRID = "#e4e4e7"; // zinc-200
const UP = "#16a34a"; // green-600
const DOWN = "#dc2626"; // red-600

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function BuysChart({ lots, averagePrice, currentPrice }: Props) {
  if (lots.length === 0) return null;

  // Inset the mark area by the largest dot radius so edge dots never overflow
  // into the axis labels or reference-line captions.
  const M = 12;
  const x0 = PAD.left + M;
  const x1 = W - PAD.right - M;
  const y0 = PAD.top + M;
  const y1 = H - PAD.bottom - M;

  // y-domain covers every lot price plus the two reference lines, padded 5%.
  const prices = [...lots.map((l) => l.price), averagePrice, currentPrice];
  let yMin = Math.min(...prices);
  let yMax = Math.max(...prices);
  const pad = (yMax - yMin || yMax || 1) * 0.05;
  yMin -= pad;
  yMax += pad;

  // x-domain over purchase dates (single/duplicate dates collapse to centre).
  const times = lots.map((l) => new Date(l.date).getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const maxQty = Math.max(...lots.map((l) => l.quantity));

  const x = (t: number) =>
    tMax === tMin ? (x0 + x1) / 2 : x0 + ((t - tMin) / (tMax - tMin)) * (x1 - x0);
  const y = (p: number) => y0 + (1 - (p - yMin) / (yMax - yMin)) * (y1 - y0);
  const r = (q: number) => 5 + (maxQty ? (q / maxQty) * 6 : 0);

  const yAvg = y(averagePrice);
  const yCur = y(currentPrice);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="Your purchases plotted by date and price"
    >
      {/* y grid + min/max labels */}
      {[yMax, (yMax + yMin) / 2, yMin].map((p, i) => (
        <g key={i}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(p)}
            y2={y(p)}
            stroke={GRID}
            strokeWidth={1}
          />
          <text
            x={PAD.left - 6}
            y={y(p) + 3}
            textAnchor="end"
            fontSize={9}
            fill={MUTED}
          >
            ₹{p.toFixed(0)}
          </text>
        </g>
      ))}

      {/* average-cost (dashed) and live-price (solid) reference lines */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={yAvg}
        y2={yAvg}
        stroke={MUTED}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <text x={W - PAD.right + 4} y={yAvg + 3} fontSize={9} fill={MUTED}>
        Avg
      </text>
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={yCur}
        y2={yCur}
        stroke={INK}
        strokeWidth={1.5}
      />
      <text x={W - PAD.right + 4} y={yCur + 3} fontSize={9} fill={INK}>
        LTP
      </text>

      {/* one dot per buy */}
      {lots.map((l, i) => {
        const up = currentPrice >= l.price; // bought below live price = in profit
        const pl = (currentPrice - l.price) * l.quantity;
        return (
          <circle
            key={i}
            cx={x(new Date(l.date).getTime())}
            cy={y(l.price)}
            r={r(l.quantity)}
            fill={up ? UP : DOWN}
            fillOpacity={0.85}
            stroke="#fff"
            strokeWidth={1.5}
          >
            <title>
              {fmtDate(l.date)} · {l.quantity} @ ₹{l.price.toFixed(2)} ·{" "}
              {pl >= 0 ? "+" : ""}
              {pl.toFixed(2)}
            </title>
          </circle>
        );
      })}

      {/* x date range labels */}
      <text x={PAD.left} y={H - 6} fontSize={9} fill={MUTED} textAnchor="start">
        {fmtDate(lots[0].date)}
      </text>
      {tMax !== tMin && (
        <text
          x={W - PAD.right}
          y={H - 6}
          fontSize={9}
          fill={MUTED}
          textAnchor="end"
        >
          {fmtDate(lots[lots.length - 1].date)}
        </text>
      )}
    </svg>
  );
}
