"use client";
// The pipeline while it runs: four stages on one line. Chips move stage to stage (shared layoutId),
// then fly into their row on the board.
import { AnimatePresence, motion } from "motion/react";
import type { JobState, Stage } from "@/lib/useMachine";
import { Barcode } from "./Barcode";
import { Chip } from "./Chip";

const MAX_JUDGING = 3;

export function Rail({ jobs, assessor }: { jobs: JobState[]; assessor: "rules" | "jev" | null }) {
  const at = (stage: Stage) => jobs.filter((j) => j.stage === stage);
  const found = at("found");
  const parsing = at("parsing");
  const judging = at("judging");
  const ranked = at("ranked");

  return (
    <motion.section
      className="rail running"
      aria-label="Progress"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
    >
      <Stage label="Found" count={found.length} active={found.length > 0}>
        <div className="chips">{found.map((j) => <Chip key={j.card.id} id={j.card.id} company={j.card.company} />)}</div>
      </Stage>
      <Stage label="Reading" count={parsing.length} active={parsing.length > 0}>
        <div className="chips">{parsing.map((j) => <Chip key={j.card.id} id={j.card.id} company={j.card.company} />)}</div>
      </Stage>
      <Stage label={assessor === "jev" ? "Jev" : "Rules"} count={judging.length} active={judging.length > 0}>
        <AnimatePresence initial={false}>
          {judging.slice(0, MAX_JUDGING).map((j) => (
            <motion.div key={j.card.id} className="specimen" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Chip id={j.card.id} company={j.card.company} className="judging" />
              <div>
                <div className="t">{j.card.title}</div>
                <Barcode assessed={j.assessed} count={j.requirements} revealed={j.revealed} small />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </Stage>
      <Stage label="Ranked" count={ranked.length} active={false}>{null}</Stage>
    </motion.section>
  );
}

function Stage({ label, count, active, children }: { label: string; count: number; active: boolean; children: React.ReactNode }) {
  return (
    <div className={`stage${active ? " active" : ""}`}>
      <div className="stage-head">{label} <b>{count}</b></div>
      {children}
    </div>
  );
}
