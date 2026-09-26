"use client";
import { motion } from "motion/react";
import { TIER_ORDER, type RankedJob, type Tier } from "@jevjob/core";
import { TIERS } from "@/lib/tiers";

export function TierBar({ ranked, filter, onFilter, compact = false }: {
  ranked: RankedJob[];
  filter?: Tier | null;
  onFilter?: (tier: Tier | null) => void;
  compact?: boolean;
}) {
  const counts = Object.fromEntries(TIER_ORDER.map((t) => [t, ranked.filter((r) => r.tier === t).length])) as Record<Tier, number>;

  return (
    <div>
      <div className="tierbar" role="img" aria-label={TIER_ORDER.map((t) => `${TIERS[t].label} ${counts[t]}`).join(", ")}>
        {TIER_ORDER.map((t) => (
          <motion.span
            key={t}
            className="seg"
            style={{ background: TIERS[t].color }}
            animate={{ flexGrow: counts[t], opacity: counts[t] ? 1 : 0 }}
            initial={false}
            transition={{ type: "spring", stiffness: 200, damping: 28 }}
          />
        ))}
      </div>
      {!compact && onFilter && (
        <div className="legend">
          {TIER_ORDER.map((t) => (
            <button key={t} aria-pressed={filter === t} onClick={() => onFilter(filter === t ? null : t)} title={TIERS[t].blurb}>
              <span className="sw" style={{ background: TIERS[t].color }} />
              {TIERS[t].label} <b>{counts[t]}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
