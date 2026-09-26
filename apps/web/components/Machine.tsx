"use client";
import { AnimatePresence, motion } from "motion/react";
import type { JobState, Stage } from "@/lib/useMachine";
import { Barcode } from "./Barcode";
import { Chip } from "./Chip";

const MAX_SPECIMENS = 4;

export function Machine({ jobs, assessor, children }: {
  jobs: JobState[];
  assessor: "rules" | "jev" | null;
  /** The RANKED station's body (the tier bar), owned by the page. */
  children: React.ReactNode;
}) {
  const at = (stage: Stage) => jobs.filter((j) => j.stage === stage);
  const found = at("found");
  const parsing = at("parsing");
  const judging = at("judging");
  const ranked = at("ranked");
  const shown = judging.slice(0, MAX_SPECIMENS);

  // Once everything is ranked, empty stations summarize the run instead of sitting at zero.
  const settled = jobs.length > 0 && ranked.length === jobs.length;
  const requirements = jobs.reduce((s, j) => s + (j.requirements ?? 0), 0);
  const timed = jobs.filter((j) => j.ms !== null && !j.cached);
  const avgMs = timed.length ? timed.reduce((s, j) => s + j.ms!, 0) / timed.length : null;
  const cached = jobs.filter((j) => j.cached).length;
  const fallbacks = jobs.filter((j) => j.fallback).length;

  return (
    <section className="machine" aria-label="Pipeline">
      <Station name="FOUND" count={found.length} active={found.length > 0}>
        {settled ? (
          <Rest big={jobs.length}>postings read</Rest>
        ) : (
          <div className="tray">
            {found.map((j) => <Chip key={j.card.id} id={j.card.id} company={j.card.company} />)}
          </div>
        )}
      </Station>

      <Station name="PARSING" count={parsing.length} active={parsing.length > 0}>
        {settled ? (
          <Rest big={requirements}>requirements extracted: skills, degrees, years, eligibility</Rest>
        ) : (
          <div className="tray">
            {parsing.map((j) => <Chip key={j.card.id} id={j.card.id} company={j.card.company} className="parsing" />)}
          </div>
        )}
      </Station>

      <Station name={assessor === "jev" ? "JEV" : "RULES"} count={judging.length} active={judging.length > 0} extra="jev">
        {settled && (
          <Rest big={avgMs === null ? "cached" : avgMs < 10 ? `${avgMs.toFixed(2)} ms` : `${Math.round(avgMs)} ms`}>
            {assessor === "jev"
              ? `per job, one Jev call each${cached ? ` · ${cached} answered from cache` : ""}`
              : "per job, zero API calls: fast, free, and less accurate"}
            {fallbacks > 0 && ` · ${fallbacks} fell back to rules`}
          </Rest>
        )}
        <div className="specimen-stack">
          <AnimatePresence initial={false}>
            {shown.map((j) => (
              <motion.div
                key={j.card.id}
                className="specimen"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
                layout
              >
                <Chip id={j.card.id} company={j.card.company} />
                <div className="meta">
                  <div className="t">{j.card.title}</div>
                  <Barcode assessed={j.assessed} count={j.requirements} revealed={j.revealed} small />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {judging.length > MAX_SPECIMENS && <div className="fine">+{judging.length - MAX_SPECIMENS} more in flight</div>}
        </div>
      </Station>

      <Station name="RANKED" count={ranked.length} active={false}>
        {children}
      </Station>
    </section>
  );
}

function Rest({ big, children }: { big: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.div className="station-rest" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <b>{big}</b>
      {children}
    </motion.div>
  );
}

function Station({ name, count, active, extra = "", children }: {
  name: string;
  count: number;
  active: boolean;
  extra?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`station ${extra}${active ? " active" : ""}`}>
      <div className="station-head">
        <span className="station-name">{name}</span>
        <motion.span key={count} className="station-count" initial={{ opacity: 0.4, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          {count}
        </motion.span>
      </div>
      {children}
    </div>
  );
}
