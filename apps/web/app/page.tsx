"use client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, MotionGlobalConfig } from "motion/react";
import { rankJobs, type Tier } from "@jevjob/core";
import { Aggressiveness } from "@/components/Aggressiveness";
import { Board } from "@/components/Board";
import { Detail } from "@/components/Detail";
import { Intro, type Setup } from "@/components/Intro";
import { Machine } from "@/components/Machine";
import { TierBar } from "@/components/TierBar";
import { TIERS } from "@/lib/tiers";
import { useMachine } from "@/lib/useMachine";

// ?still jumps every animation to its end state: for screenshots and browser tests. Set at module load,
// because child components start their entrance animations before the page's own effects run.
const STILL = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("still");
if (STILL) MotionGlobalConfig.skipAnimations = true;

export default function Page() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [resume, setResume] = useState("");
  const [engine, setEngine] = useState<"rules" | "jev">("rules");
  const [aggressiveness, setAggressiveness] = useState(0.5);
  const [filter, setFilter] = useState<Tier | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { state, start, reset } = useMachine();

  useEffect(() => {
    if (STILL) document.documentElement.dataset.still = "";
    fetch("/api/setup")
      .then((r) => r.json() as Promise<Setup>)
      .then((s) => {
        setSetup(s);
        if (s.jev) setEngine("jev");
      })
      .catch(() => setSetup(null));
  }, []);

  const jobs = useMemo(() => state.order.map((id) => state.jobs[id]!), [state.order, state.jobs]);
  // Facts are fixed once a job is ranked; only this line re-runs when the slider moves.
  const ranked = useMemo(
    () => rankJobs(jobs.filter((j) => j.stage === "ranked" && j.assessed).map((j) => j.assessed!), aggressiveness),
    [jobs, aggressiveness],
  );
  const visible = filter ? ranked.filter((r) => r.tier === filter) : ranked;
  const open = ranked.find((r) => r.job.id === openId) ?? null;
  const settled = jobs.length > 0 && jobs.every((j) => j.stage === "ranked");
  const times = jobs.filter((j) => j.ms !== null && !j.cached).map((j) => j.ms!);
  const avgMs = times.length ? times.reduce((s, t) => s + t, 0) / times.length : null;

  const home = () => {
    reset();
    setOpenId(null);
    setFilter(null);
  };

  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="/" onClick={(e) => { e.preventDefault(); home(); }}>
          <b>Jev<i>Job</i></b>
          <span>typed decisions, not vibes</span>
        </a>
        <div className="spacer" />
        {state.status !== "idle" && (
          <>
            <span className={`badge${settled ? "" : " live"}`}>
              <span className="dot" />
              {state.assessor === "jev" ? `Jev · ${state.model}` : "Rules"}
              {avgMs !== null && ` · ${avgMs < 10 ? avgMs.toFixed(2) : Math.round(avgMs)} ms/job`}
              {state.assessor === "jev" && " · 1 call/job"}
            </span>
            <span className="badge">{state.source === "harness" ? "Live postings from your harness" : "Demo postings · fictional"}</span>
            <button className="ghost-btn" onClick={home}>New resume</button>
          </>
        )}
      </header>

      <AnimatePresence mode="wait">
        {state.status === "idle" || state.status === "error" ? (
          <motion.div key="intro" exit={{ opacity: 0, y: -12, transition: { duration: 0.25 } }}>
            <Intro
              setup={setup}
              resume={resume}
              setResume={setResume}
              engine={engine}
              setEngine={setEngine}
              onRun={() => start(resume, engine)}
              error={state.error}
            />
          </motion.div>
        ) : (
          <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <LayoutGroup>
              <Machine jobs={jobs} assessor={state.assessor}>
                <div className="ranked-summary">
                  <TierBar ranked={ranked} compact />
                  <div className="mini">
                    {ranked.filter((r) => r.tier === "apply").length} to apply · {ranked.filter((r) => r.tier === "maybe").length} maybe
                  </div>
                </div>
              </Machine>

              <div className="controls">
                <Aggressiveness value={aggressiveness} onChange={setAggressiveness} />
                <div className="panel">
                  <div className="panel-title">
                    <span>THE POOL</span>
                    <span>{filter ? `showing ${TIERS[filter].label}` : "tap a tier to filter"}</span>
                  </div>
                  <TierBar ranked={ranked} filter={filter} onFilter={setFilter} />
                </div>
              </div>

              <div className="board-head">
                <h2>Most qualified → least</h2>
                <span>{settled ? `${ranked.length} ranked` : `ranking ${ranked.length} of ${jobs.length}…`}</span>
              </div>
              <Board ranked={visible} onOpen={setOpenId} />
            </LayoutGroup>

            <p className="footer">
              Tiers come from requirement coverage and classifier confidence. JevJob never estimates your chance of being hired.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{open && <Detail key={open.job.id} r={open} onClose={() => setOpenId(null)} />}</AnimatePresence>
    </main>
  );
}
