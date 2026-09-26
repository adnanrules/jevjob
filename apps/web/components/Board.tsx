"use client";
import { AnimatePresence, motion } from "motion/react";
import type { RankedJob } from "@jevjob/core";
import { TIERS } from "@/lib/tiers";
import { Barcode } from "./Barcode";
import { Chip } from "./Chip";

export type DetailTab = "match" | "posting";

export function Board({ ranked, onOpen }: { ranked: RankedJob[]; onOpen: (id: string, tab: DetailTab) => void }) {
  return (
    <div className="board">
      <AnimatePresence initial={false}>
        {ranked.map((r) => <Row key={r.job.id} r={r} onOpen={onOpen} />)}
      </AnimatePresence>
      {ranked.length === 0 && <div className="empty">Nothing here yet.</div>}
    </div>
  );
}

function Row({ r, onOpen: open }: { r: RankedJob; onOpen: (id: string, tab: DetailTab) => void }) {
  const onOpen = (id: string) => open(id, "match");
  const tier = TIERS[r.tier];
  const req = r.coverage.required;
  return (
    <motion.div
      layout="position"
      className="row"
      style={{ ["--tier" as string]: tier.color }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 420, damping: 40 }}
      onClick={() => onOpen(r.job.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(r.job.id)}
      role="button"
      tabIndex={0}
      aria-label={`${r.rank}. ${tier.label}. ${r.job.title} at ${r.job.company}`}
    >
      <motion.div key={r.rank} className="rank" initial={{ opacity: 0.3, y: -4 }} animate={{ opacity: 1, y: 0 }} title={tier.label}>
        {r.rank}
      </motion.div>
      <Chip id={r.job.id} company={r.job.company} />
      <div className="who">
        <div className="title">{r.job.title}</div>
        <div className="sub">{r.job.company}{r.job.location ? ` · ${r.job.location}` : ""}</div>
      </div>
      {r.requirements.length ? <Barcode assessed={r} revealed /> : <span className="unread">no requirements listed</span>}
      <div className="cov" title="Required qualifications you meet">{req.total ? `${req.met}/${req.total}` : "–"}</div>
      <div className="row-actions">
        <button className="view" onClick={(e) => { e.stopPropagation(); open(r.job.id, "posting"); }}>View</button>
        <a className="apply" href={r.job.applyUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          Apply ↗
        </a>
      </div>
    </motion.div>
  );
}
