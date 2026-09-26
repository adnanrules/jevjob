"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, MotionGlobalConfig } from "motion/react";
import { rankJobs, type Tier } from "@jevjob/core";
import { Background, pulse } from "@/components/Background";
import { Batches } from "@/components/Batches";
import { Board, type DetailTab } from "@/components/Board";
import { Detail } from "@/components/Detail";
import { FitMap } from "@/components/FitMap";
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

const BATCH = 50;
type PoolInfo = { version: string; source: "harness" | "demo"; jobCount: number };

export default function Page() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [engine, setEngine] = useState<"rules" | "jev">("rules");
  const [aggressiveness, setAggressiveness] = useState(0.5);
  const [filter, setFilter] = useState<Tier | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<DetailTab>("match");
  const [dragging, setDragging] = useState(false);
  const [lastResume, setLastResume] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolInfo | null>(null);
  const { state, start, reset } = useMachine();

  // A harness can add postings (/jevjob, /jevjob more) while the app is open. Poll a tiny endpoint so the
  // landing count stays current and an open board can offer to rank what's new.
  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.hidden) return;
      fetch("/api/pool").then((r) => r.json() as Promise<PoolInfo>).then((p) => alive && setPool(p)).catch(() => {});
    };
    check();
    const timer = window.setInterval(check, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

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

  const run = (text: string, batch = 0) => {
    setLastResume(text);
    setFilter(null);
    setOpenId(null);
    void start(text, engine, batch);
  };

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
  const tints = useMemo(() => ranked.map((r) => TIERS[r.tier].color), [ranked]);
  const count = (t: Tier) => ranked.filter((r) => r.tier === t).length;

  // Every job that lands on the board sends a ripple through the background, in its tier's color, from its row.
  const pulsed = useRef(new Set<string>());
  useEffect(() => {
    if (STILL) return;
    for (const r of ranked) {
      if (pulsed.current.has(r.job.id)) continue;
      pulsed.current.add(r.job.id);
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-row="${CSS.escape(r.job.id)}"]`);
        const box = row?.getBoundingClientRect();
        if (box && box.top < window.innerHeight) pulse(box.left + 32, box.top + box.height / 2, TIERS[r.tier].color);
      });
    }
  }, [ranked]);
  useEffect(() => {
    if (state.status === "running" && jobs.every((j) => j.stage === "found")) pulsed.current.clear();
  }, [state.status, jobs]);

  // New postings arrived after this run: appended ones start a new batch; a replaced pool starts over.
  const poolChanged = settled && pool && state.poolVersion && pool.version !== state.poolVersion && lastResume;
  const grew = pool && pool.jobCount > state.poolSize;
  const batches = Math.max(state.batches, pool ? Math.ceil(pool.jobCount / BATCH) : 0);

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
                <span>{state.source === "demo" ? "Sample roles" : "Live roles"} {state.batch * BATCH + 1}–{state.batch * BATCH + jobs.length} of {Math.max(state.poolSize, pool?.jobCount ?? 0)}</span>
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
                {poolChanged && (
                  <motion.div className="notice" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <span>
                      {grew ? `${pool.jobCount - state.poolSize} new postings arrived` : `New job pool loaded: ${pool.jobCount} roles`}
                    </span>
                    <button className="btn small" onClick={() => run(lastResume, grew ? Math.floor(state.poolSize / BATCH) : 0)}>
                      {grew ? "Rank them" : "Re-rank with this resume"}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {settled && (
                  <motion.div className="verdict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
                    <Figure n={count("apply")} label="apply now" color={TIERS.apply.color} />
                    <Figure n={count("maybe")} label="worth a try" color={TIERS.maybe.color} />
                    <Figure n={count("stretch") + count("big_stretch")} label="stretches" color={TIERS.stretch.color} />
                    <Figure n={count("no")} label="blocked" color={TIERS.no.color} />
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
                  <div className="board-title">
                    <h2>{settled ? "Best fit first" : `Ranking ${ranked.length} of ${jobs.length}`}</h2>
                    {settled && (
                      <div className="segmented small" role="group" aria-label="View">
                        <button aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
                        <button aria-pressed={view === "map"} onClick={() => setView("map")}>Fit map</button>
                      </div>
                    )}
                  </div>
                  <Slider value={aggressiveness} onChange={setAggressiveness} />
                </div>
                {settled && view === "map" ? (
                  <FitMap ranked={visible} onOpen={(id) => { setOpenId(id); setOpenTab("match"); }} />
                ) : (
                  <Board ranked={visible} onOpen={(id, tab) => { setOpenId(id); setOpenTab(tab); }} />
                )}
              </LayoutGroup>

              {settled && lastResume && (
                <Batches batch={state.batch} batches={batches} poolSize={Math.max(state.poolSize, pool?.jobCount ?? 0)} busy={!settled} onBatch={(b) => run(lastResume, b)} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>{open && <Detail key={open.job.id} r={open} tab={openTab} onTab={setOpenTab} onClose={() => setOpenId(null)} />}</AnimatePresence>
    </>
  );
}

/** A big count that ticks up from zero. */
function Figure({ n, label, color }: { n: number; label: string; color: string }) {
  const [shown, setShown] = useState(STILL ? n : 0);
  useEffect(() => {
    if (STILL) return setShown(n);
    let frame = 0;
    const startAt = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startAt) / 900);
      setShown(Math.round(n * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [n]);
  return (
    <div className="figure">
      <b style={{ color: n ? color : "var(--faint)" }}>{shown}</b>
      <span>{label}</span>
    </div>
  );
}
