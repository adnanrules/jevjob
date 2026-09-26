"use client";
// Drives the pipeline animation from the server's real events.
// Each job moves found → parsing → judging → ranked. Events are released at a minimum spacing so an
// instant rules run is still watchable; the data shown is always the real result.
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AssessedJob } from "@jevjob/core";
import type { JobCard, RankEvent } from "./events";

export type Stage = "found" | "parsing" | "judging" | "ranked";

export interface JobState {
  card: JobCard;
  stage: Stage;
  requirements: number | null;
  assessed: AssessedJob | null;
  /** Colors are shown only once the real verdicts have arrived. */
  revealed: boolean;
  ms: number | null;
  cached: boolean;
  fallback: boolean;
}

export interface MachineState {
  status: "idle" | "running" | "done" | "error";
  assessor: "rules" | "jev" | null;
  model: string | null;
  source: "harness" | "demo" | null;
  /** Which version of the job pool this run ranked; the page compares it with the live pool. */
  poolVersion: string | null;
  order: string[];
  jobs: Record<string, JobState>;
  error: string | null;
}

type Action =
  | { type: "reset" }
  | { type: "event"; event: RankEvent }
  | { type: "stage"; id: string; stage: Stage; revealed?: boolean };

const initial: MachineState = { status: "idle", assessor: null, model: null, source: null, poolVersion: null, order: [], jobs: {}, error: null };

function reducer(state: MachineState, action: Action): MachineState {
  if (action.type === "reset") return initial;
  if (action.type === "stage") {
    const job = state.jobs[action.id];
    if (!job) return state;
    return { ...state, jobs: { ...state.jobs, [action.id]: { ...job, stage: action.stage, revealed: action.revealed ?? job.revealed } } };
  }
  const e = action.event;
  switch (e.type) {
    case "start":
      return {
        ...initial,
        status: "running",
        assessor: e.assessor,
        model: e.model,
        source: e.source,
        poolVersion: e.poolVersion,
        order: e.jobs.map((j) => j.id),
        jobs: Object.fromEntries(
          e.jobs.map((card) => [card.id, { card, stage: "found", requirements: null, assessed: null, revealed: false, ms: null, cached: false, fallback: false }]),
        ),
      };
    case "parsed": {
      const job = state.jobs[e.id];
      return job ? { ...state, jobs: { ...state.jobs, [e.id]: { ...job, stage: "parsing", requirements: e.requirements } } } : state;
    }
    case "assessed": {
      const job = state.jobs[e.id];
      return job
        ? { ...state, jobs: { ...state.jobs, [e.id]: { ...job, assessed: e.assessed, ms: e.ms, cached: e.cached, fallback: e.fallback } } }
        : state;
    }
    case "done":
      return { ...state, status: "done" };
    case "error":
      return { ...state, status: "error", error: e.message };
  }
}

const EVENT_GAP_MS = 85;
const PARSE_TO_JUDGE_MS = 320;
const REVEAL_TO_RANK_MS = 760;

export function useMachine() {
  const [state, dispatch] = useReducer(reducer, initial);
  const timers = useRef<number[]>([]);
  const run = useRef(0);

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const clear = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  useEffect(() => clear, [clear]);

  const start = useCallback(
    async (resume: string, assessor: "rules" | "jev") => {
      clear();
      const runId = ++run.current;
      dispatch({ type: "reset" });

      const response = await fetch("/api/rank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume, assessor }),
      }).catch(() => null);
      if (!response?.ok || !response.body) {
        const message = response ? ((await response.json().catch(() => null)) as { error?: string } | null)?.error : null;
        dispatch({ type: "event", event: { type: "error", message: message ?? "Couldn't reach the server." } });
        return;
      }

      // Release events on a steady beat; per-job follow-ups are scheduled relative to that beat.
      let releaseAt = performance.now();
      const judgeAt = new Map<string, number>();
      const release = (event: RankEvent) => {
        const now = performance.now();
        releaseAt = Math.max(releaseAt + (event.type === "start" ? 0 : EVENT_GAP_MS), now);
        const at = releaseAt;
        later(at - now, () => {
          if (run.current !== runId) return;
          dispatch({ type: "event", event });
          if (event.type === "parsed") {
            judgeAt.set(event.id, at + PARSE_TO_JUDGE_MS);
            later(PARSE_TO_JUDGE_MS, () => run.current === runId && dispatch({ type: "stage", id: event.id, stage: "judging" }));
          }
          if (event.type === "assessed") {
            const reveal = Math.max(0, (judgeAt.get(event.id) ?? at) - performance.now()) + 60;
            later(reveal, () => run.current === runId && dispatch({ type: "stage", id: event.id, stage: "judging", revealed: true }));
            later(reveal + REVEAL_TO_RANK_MS, () => run.current === runId && dispatch({ type: "stage", id: event.id, stage: "ranked" }));
          }
        });
      };

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) release(JSON.parse(line) as RankEvent);
        }
      }
    },
    [clear, later],
  );

  const reset = useCallback(() => {
    clear();
    run.current++;
    dispatch({ type: "reset" });
  }, [clear]);

  return { state, start, reset };
}
