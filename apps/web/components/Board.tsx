"use client";
import { AnimatePresence, motion } from "motion/react";
import type { RankedJob } from "@jevjob/core";
import { TIERS } from "@/lib/tiers";
import { Barcode } from "./Barcode";
import { Chip } from "./Chip";

export function Board({ ranked, onOpen }: { ranked: RankedJob[]; onOpen: (id: string) => void }) {
  if (ranked.length === 0) return <div className="empty">Ranked jobs land here as they come out of the machine.</div>;
  return (
    <div className="board">
      <AnimatePresence initial={false}>
        {ranked.map((r) => <Row key={r.job.id} r={r} onOpen={onOpen} />)}
      </AnimatePresence>
    </div>
  );
}

function Row({ r, onOpen }: { r: RankedJob; onOpen: (id: string) => void }) {
  const tier = TIERS[r.tier];
  const req = r.coverage.required;
  return (
    <motion.div
      layout="position"
      className="row"
      style={{ ["--tier" as string]: tier.color }}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      onClick={() => onOpen(r.job.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(r.job.id)}
      role="button"
      tabIndex={0}
      aria-label={`#${r.rank} ${tier.label}: ${r.job.title} at ${r.job.company}`}
    >
      <motion.div key={`${r.rank}-${r.tier}`} className="rank" initial={{ opacity: 0.2, y: -6 }} animate={{ opacity: 1, y: 0 }}>
        {r.rank}
      </motion.div>
      <Chip id={r.job.id} company={r.job.company} />
      <div className="who">
        <div className="title">{r.job.title}</div>
        <div className="sub">{r.job.company} · {r.job.location}</div>
      </div>
      <Barcode assessed={r} revealed />
      <div className="cov">
        <span className="tier-pill">{tier.label}</span>
        <span className="n">
          {req.met}/{req.total} required{req.unclear ? <span className="q"> · {req.unclear} unclear</span> : null}
        </span>
      </div>
      <a className="apply-link" href={r.job.applyUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        Apply ↗
      </a>
    </motion.div>
  );
}
