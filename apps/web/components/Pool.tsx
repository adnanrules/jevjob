"use client";
// The tier distribution. It's also the legend (what each color means) and the filter.
import { motion } from "motion/react";
import { TIER_ORDER, type RankedJob, type Tier } from "@jevjob/core";
import { TIERS } from "@/lib/tiers";

export function Pool({ ranked, filter, onFilter }: { ranked: RankedJob[]; filter: Tier | null; onFilter: (t: Tier | null) => void }) {
  const counts = Object.fromEntries(TIER_ORDER.map((t) => [t, ranked.filter((r) => r.tier === t).length])) as Record<Tier, number>;
  const toggle = (t: Tier) => onFilter(filter === t ? null : t);

  return (
    <motion.section className="pool" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}>
      <div className={`pool-bar${filter ? " filtered" : ""}`}>
        {TIER_ORDER.map((t) => (
          <motion.button
            key={t}
            aria-label={`${TIERS[t].label}: ${counts[t]}`}
            aria-pressed={filter === t}
            onClick={() => toggle(t)}
            style={{ background: TIERS[t].color }}
            initial={false}
            animate={{ flexGrow: counts[t], display: counts[t] ? "block" : "none" }}
            transition={{ type: "spring", stiffness: 220, damping: 30 }}
          />
        ))}
      </div>
      <div className="pool-labels">
        {TIER_ORDER.map((t) => (
          <button key={t} aria-pressed={filter === t} onClick={() => toggle(t)} title={TIERS[t].blurb}>
            <i style={{ background: TIERS[t].color }} />
            {TIERS[t].label} <b>{counts[t]}</b>
          </button>
        ))}
      </div>
    </motion.section>
  );
}
