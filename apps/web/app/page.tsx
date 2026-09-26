"use client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, MotionGlobalConfig } from "motion/react";
import { rankJobs, type Tier } from "@jevjob/core";
import { Background } from "@/components/Background";
import { Board } from "@/components/Board";
import { Detail } from "@/components/Detail";
import { Landing, type Setup } from "@/components/Landing";
import { Mark } from "@/components/Mark";
import { Pool } from "@/components/Pool";
import { Rail } from "@/components/Rail";
import { Slider } from "@/components/Slider";
import { TIERS } from "@/lib/tiers";
import { useMachine } from "@/lib/useMachine";

// ?still jumps every animation to its end state: for screenshots and browser tests. Set at module load,
// because child components start their entrance animations before the page's own effects run.
const STILL = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("still");
if (STILL) MotionGlobalConfig.skipAnimations = true;

export default function Page() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [engine, setEngine] = useState<"rules" | "jev">("rules");
  const [aggressiveness, setAggressiveness] = useState(0.5);
  const [filter, setFilter] = useState<Tier | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lastResume, setLastResume] = useState<string | null>(null);
  const [pool, setPool] = useState<{ version: string; source: "harness" | "demo"; jobCount: number } | null>(null);
  const { state, start, reset } = useMachine();

  // A harness can load a new pool (/jevjob again, or "more") while the app is open. Poll a tiny endpoint
  // so the landing count stays current and an open board can offer to re-rank.
  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.hidden) return;
      fetch("/api/pool").then((r) => r.json()).then((p) => alive && setPool(p)).catch(() => {});
    };
    check();
    const timer = window.setInterval(check, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const run = (text: string) => {
    setLastResume(text);
    setFilter(null);
    setOpenId(null);
    void start(text, engine);
  };

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
  // Facts are fixed once a job is ranked; only this re-runs when the slider moves.
  const ranked = useMemo(
    () => rankJobs(jobs.filter((j) => j.stage === "ranked" && j.assessed).map((j) => j.assessed!), aggressiveness),
    [jobs, aggressiveness],
  );
  const visible = filter ? ranked.filter((r) => r.tier === filter) : ranked;
  const open = ranked.find((r) => r.job.id === openId) ?? null;
  const idle = state.status === "idle" || state.status === "error";
  const settled = jobs.length > 0 && jobs.every((j) => j.stage === "ranked");
  // The background picks up the results' colors, in proportion.
  const tints = useMemo(() => ranked.map((r) => TIERS[r.tier].color), [ranked]);

  const home = () => {
    reset();
    setOpenId(null);
    setFilter(null);
  };

  return (
    <>
      <Background energy={!idle && !settled ? 1 : dragging ? 0.45 : 0} focus={idle ? 0.28 : 0.5} tints={settled ? tints : []} />
      <main className="shell">
        <header className="top">
          <Mark onClick={home} />
          <div className="top-meta">
            {idle ? (
              <div className="segmented" role="group" aria-label="Classifier">
                <button aria-pressed={engine === "jev"} disabled={!setup?.jev} onClick={() => setEngine("jev")} aria-label="Jev"
                  title={setup?.jev ? `TypeSafe ${setup.jev.model}: requirements are classified by TypeSafe's API` : "Add TYPESAFE_API_KEY to .env to use Jev"}>
                  Jev
                </button>
                <button aria-pressed={engine === "rules"} onClick={() => setEngine("rules")} aria-label="Rules" title="Keyword rules, fully local">Rules</button>
              </div>
            ) : (
              <>
                <span>{jobs.length} {state.source === "demo" ? "sample roles" : "roles"}</span>
                <span className="sep" />
                <span>{state.assessor === "jev" ? `Jev ${state.model?.replace(/^.*\//, "") ?? ""}` : "Rules"}</span>
                <span className="sep" />
                <button className="link-btn" onClick={home}>New resume</button>
              </>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {idle ? (
            <Landing key="landing" setup={setup && pool ? { ...setup, source: pool.source, jobCount: pool.jobCount } : setup} onRun={run} error={state.error} onDragChange={setDragging} />
          ) : (
            <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AnimatePresence>
                {settled && pool && state.poolVersion && pool.version !== state.poolVersion && lastResume && (
                  <motion.div className="notice" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <span>New job pool loaded: {pool.jobCount} {pool.source === "demo" ? "sample roles" : "roles"}</span>
                    <button className="btn small" onClick={() => run(lastResume)}>Re-rank with this resume</button>
                  </motion.div>
                )}
              </AnimatePresence>
              <LayoutGroup>
                <AnimatePresence mode="popLayout">
                  {settled ? (
                    <Pool key="pool" ranked={ranked} filter={filter} onFilter={setFilter} />
                  ) : (
                    <Rail key="rail" jobs={jobs} assessor={state.assessor} />
                  )}
                </AnimatePresence>

                <div className="board-top">
                  <h2>{settled ? "Best fit first" : `Ranking ${ranked.length} of ${jobs.length}`}</h2>
                  <Slider value={aggressiveness} onChange={setAggressiveness} />
                </div>
                <Board ranked={visible} onOpen={setOpenId} />
              </LayoutGroup>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>{open && <Detail key={open.job.id} r={open} onClose={() => setOpenId(null)} />}</AnimatePresence>
    </>
  );
}
