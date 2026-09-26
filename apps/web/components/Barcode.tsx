"use client";
// One bar per requirement: tall = required, short = preferred, colored by verdict.
// Before the real verdicts arrive the bars pulse grey; they never show a color that wasn't computed.
import { motion } from "motion/react";
import type { AssessedJob } from "@jevjob/core";
import { VERDICTS } from "@/lib/tiers";

export function Barcode({ assessed, count, revealed, small = false }: {
  assessed: AssessedJob | null;
  /** Number of placeholder bars to show before `assessed` exists. */
  count?: number | null;
  revealed: boolean;
  small?: boolean;
}) {
  const verdictOf = new Map(assessed?.assessments.map((a) => [a.requirementId, a.verdict]));
  const bars = assessed
    ? assessed.requirements.map((r) => ({ key: r.id, required: r.importance === "required", verdict: verdictOf.get(r.id) ?? null }))
    : Array.from({ length: count ?? 6 }, (_, i) => ({ key: String(i), required: true, verdict: null }));

  return (
    <div className={`barcode${small ? " small" : ""}`} aria-hidden>
      {bars.map((bar, i) => (
        <motion.span
          key={bar.key}
          className={`bar ${bar.required ? "req" : "pref"}${revealed ? "" : " pending"}`}
          initial={{ scaleY: 0.15 }}
          animate={{
            scaleY: 1,
            backgroundColor: revealed && bar.verdict ? VERDICTS[bar.verdict].color : "var(--line-2)",
          }}
          transition={{ delay: revealed ? i * 0.035 : i * 0.02, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        />
      ))}
    </div>
  );
}
