"use client";

import { useState } from "react";

export interface SeriesDay {
  date: string;
  [key: string]: string | number;
}

/** Lightweight SVG area chart in the house style — no chart library. */
export default function AreaChart({
  data,
  metric,
  color = "var(--accent)",
  height = 120,
}: {
  data: SeriesDay[];
  metric: string;
  color?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;

  const w = 600;
  const h = height;
  const pad = 4;
  const values = data.map((d) => Number(d[metric]) || 0);
  const max = Math.max(1, ...values);
  const stepX = (w - pad * 2) / Math.max(1, data.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const x = (i: number) => pad + i * stepX;

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height: h }}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - rect.left) / rect.width) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}
      >
        <path d={area} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad} y2={h - pad} stroke="var(--line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(values[hover])} r={3} fill={color} />
          </>
        )}
      </svg>
      {hover !== null && (
        <div className="absolute top-0 right-0 figure text-[11px] bg-ink text-paper px-2 py-1 pointer-events-none">
          {data[hover].date} · {values[hover].toLocaleString()}
        </div>
      )}
    </div>
  );
}
