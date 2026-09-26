"use client";
// The fit map: every job as a dot. Left → right is how much of the required list you meet (unclear counts half);
// bottom → top is how recently it was posted. Top-right is "apply today". Undated postings sit on the floor.
import { useState } from "react";
import { motion } from "motion/react";
import type { RankedJob } from "@jevjob/core";
import { TIERS, hueOf } from "@/lib/tiers";

const MAX_AGE_DAYS = 45;

function position(r: RankedJob, now: number) {
  const { met, unclear, total } = r.coverage.required;
  const fit = total ? (met + unclear * 0.5) / total : 0.5;
  const days = r.job.postedAt ? Math.max(0, (now - Date.parse(r.job.postedAt)) / 86_400_000) : null;
  const fresh = days === null ? 0 : 1 - Math.min(days, MAX_AGE_DAYS) / MAX_AGE_DAYS;
  // Deterministic jitter so identical scores don't stack on one pixel.
  const jx = ((hueOf(r.job.id) % 21) - 10) / 400;
  const jy = ((hueOf(r.job.company + r.job.title) % 21) - 10) / 400;
  return { x: Math.min(0.98, Math.max(0.02, fit + jx)), y: days === null ? 0.03 : Math.min(0.97, Math.max(0.08, fresh + jy)), days };
}

export function FitMap({ ranked, onOpen }: { ranked: RankedJob[]; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const now = Date.now();
  const hovered = ranked.find((r) => r.job.id === hover);

  return (
    <div className="fitmap" role="img" aria-label="Jobs placed by requirement fit and posting age">
      <div className="fitmap-plot">
        <div className="fitmap-sweet">apply today</div>
        {[0.25, 0.5, 0.75].map((v) => <i key={`v${v}`} className="grid v" style={{ left: `${v * 100}%` }} />)}
        {[0.33, 0.66].map((v) => <i key={`h${v}`} className="grid h" style={{ top: `${v * 100}%` }} />)}
        {ranked.map((r, i) => {
          const p = position(r, now);
          return (
            <motion.button
              key={r.job.id}
              className="dot"
              style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%`, ["--tier" as string]: TIERS[r.tier].color }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: hover === r.job.id ? 1.6 : 1, opacity: hover && hover !== r.job.id ? 0.35 : 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22, delay: hover ? 0 : 0.2 + i * 0.012 }}
              onMouseEnter={() => setHover(r.job.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.job.id)}
              onBlur={() => setHover(null)}
              onClick={() => onOpen(r.job.id)}
              aria-label={`${r.rank}. ${r.job.title} at ${r.job.company}, ${TIERS[r.tier].label}`}
            />
          );
        })}
        {hovered && (() => {
          const p = position(hovered, now);
          return (
            <div className="dot-tip" style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%` }} data-flip={p.x > 0.7}>
              <b style={{ color: TIERS[hovered.tier].color }}>#{hovered.rank}</b> {hovered.job.title}
              <span>{hovered.job.company} · {p.days === null ? "undated" : p.days < 1 ? "today" : `${Math.round(p.days)}d ago`} · {hovered.coverage.required.met}/{hovered.coverage.required.total} required</span>
            </div>
          );
        })()}
      </div>
      <div className="fitmap-axis x"><span>meets less</span><span>requirements met →</span><span>meets all</span></div>
      <div className="fitmap-axis y"><span>posted recently ↑</span></div>
    </div>
  );
}
