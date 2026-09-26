"use client";
import { useEffect } from "react";
import { motion } from "motion/react";
import { worstVerdict, type Assessment, type RankedJob, type Requirement, type Verdict } from "@jevjob/core";
import { TIERS, VERDICTS } from "@/lib/tiers";

interface Line {
  text: string;
  importance: Requirement["importance"];
  kinds: string[];
  verdict: Verdict;
  evidence: string | null;
  confidence: number | null;
  source: Assessment["source"];
}

/** One row per posting line: a line like "TypeScript and React" held two requirements; show it once, worst verdict. */
function linesOf(r: RankedJob): Line[] {
  const byId = new Map(r.assessments.map((a) => [a.requirementId, a]));
  const groups = new Map<string, Array<{ req: Requirement; a: Assessment | undefined }>>();
  for (const req of r.requirements) groups.set(req.text, [...(groups.get(req.text) ?? []), { req, a: byId.get(req.id) }]);
  return [...groups.entries()].map(([text, items]) => {
    const assessments = items.map((i) => i.a).filter((a): a is Assessment => Boolean(a));
    const confidences = assessments.map((a) => a.confidence).filter((c): c is number => c !== null);
    return {
      text,
      importance: items[0]!.req.importance,
      kinds: [...new Set(items.map((i) => i.req.kind))],
      verdict: worstVerdict(assessments.map((a) => a.verdict)),
      evidence: assessments.find((a) => a.evidence)?.evidence ?? null,
      confidence: confidences.length ? Math.min(...confidences) : null,
      source: assessments.some((a) => a.source === "jev") ? "jev" : "rules",
    };
  });
}

const PLACEHOLDER: Record<Verdict, string> = {
  meets: "shown on your resume",
  unclear: "not stated either way",
  does_not_meet: "nothing on your resume meets this",
};

export function Detail({ r, onClose }: { r: RankedJob; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tier = TIERS[r.tier];
  const lines = linesOf(r);
  const required = lines.filter((l) => l.importance === "required");
  const preferred = lines.filter((l) => l.importance === "preferred");
  // Counts come from the policy's coverage (per requirement), the same numbers the board and reasons use.
  const { required: reqCov, preferred: prefCov } = r.coverage;
  const confidences = r.assessments.filter((a) => a.source === "jev" && a.confidence !== null).map((a) => a.confidence!);
  const avgConfidence = confidences.length ? confidences.reduce((s, c) => s + c, 0) / confidences.length : null;
  const blockerIds = new Set(r.blockers.map((b) => b.requirementId));
  const blockerLines = r.requirements.filter((req) => blockerIds.has(req.id)).map((req) => req.text);

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${r.job.title} at ${r.job.company}`}
        style={{ ["--tier" as string]: tier.color }}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 36 }}
      >
        <div className="drawer-top">
          <div className="rank">{r.rank}</div>
          <div>
            <h3>{r.job.title}</h3>
            <p>{r.job.company} · {r.job.location}</p>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="stats">
          <div className="stat"><div className="k">Verdict</div><div className="v" style={{ color: tier.color }}>{tier.label}</div></div>
          <div className="stat">
            <div className="k">Required met</div>
            <div className="v">{reqCov.met}<small>of {reqCov.total}{reqCov.unclear ? ` · ${reqCov.unclear} unclear` : ""}</small></div>
          </div>
          <div className="stat"><div className="k">Preferred met</div><div className="v">{prefCov.met}<small>of {prefCov.total}</small></div></div>
          <div className="stat">
            <div className="k">Jev confidence</div>
            <div className="v">{avgConfidence === null ? "—" : `${Math.round(avgConfidence * 100)}%`}<small>{avgConfidence === null ? "rules" : "avg"}</small></div>
          </div>
        </div>

        {blockerLines.length > 0 && (
          <div className="blockers">
            <b>Blocker{blockerLines.length > 1 ? "s" : ""}.</b> {blockerLines.join(" · ")}. No amount of &ldquo;apply anyway&rdquo; changes these.
          </div>
        )}

        <ul className="reasons">
          {r.reasons.filter((reason) => !reason.startsWith("Blocker:")).map((reason) => <li key={reason}>{reason}</li>)}
        </ul>

        <div className="compare-head"><span>YOUR RESUME</span><span /><span>THE POSTING</span></div>
        {[...required, ...preferred].map((l, i) => (
          <motion.div
            key={l.text}
            className="crow"
            style={{ ["--vc" as string]: VERDICTS[l.verdict].color }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + i * 0.035 }}
          >
            <div className={`ev${l.evidence ? "" : " none"}`}>{l.evidence ?? PLACEHOLDER[l.verdict]}</div>
            <Wire verdict={l.verdict} delay={0.2 + i * 0.035} />
            <div className="req">
              <div className="text">{l.text}</div>
              <div className="tags">
                <span>{l.importance}</span>
                <span>{VERDICTS[l.verdict].label.toLowerCase()}</span>
                {l.source === "jev" && l.confidence !== null && (
                  <span className="conf" title="How sure Jev is about this verdict. Not a chance of being hired.">
                    <i style={{ ["--c" as string]: `${Math.round(l.confidence * 100)}%` }} />
                    {Math.round(l.confidence * 100)}%
                  </span>
                )}
                {l.source === "rules" && <span>rules</span>}
              </div>
            </div>
          </motion.div>
        ))}

        <div style={{ display: "flex", gap: 12, marginTop: 22, alignItems: "center", flexWrap: "wrap" }}>
          <a className="run-btn" style={{ marginLeft: 0, textDecoration: "none" }} href={r.job.applyUrl} target="_blank" rel="noopener noreferrer">
            Apply on {r.job.company}&rsquo;s site ↗
          </a>
          <span className="fine" style={{ marginTop: 0 }}>{new URL(r.job.applyUrl).hostname}</span>
        </div>

        <p className="note">
          Percentages here are Jev&rsquo;s confidence in each verdict and your coverage of the posting&rsquo;s requirements.
          JevJob never estimates your chance of being hired.
        </p>
      </motion.aside>
    </>
  );
}

/** The connector between resume and posting: solid when met, dashed when unclear, broken when missing. */
function Wire({ verdict, delay }: { verdict: Verdict; delay: number }) {
  const color = VERDICTS[verdict].color;
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { delay, duration: 0.45 } };
  return (
    <svg className="wire" viewBox="0 0 120 24" aria-hidden>
      {verdict === "meets" && (
        <>
          <motion.path d="M6 12 H114" stroke={color} strokeWidth="1.6" fill="none" {...draw} />
          <circle cx="6" cy="12" r="3" fill={color} />
          <circle cx="114" cy="12" r="3" fill={color} />
        </>
      )}
      {verdict === "unclear" && (
        <>
          <motion.path d="M6 12 H114" stroke={color} strokeWidth="1.6" strokeDasharray="4 5" fill="none" {...draw} />
          <circle cx="60" cy="12" r="8" fill="var(--bg)" stroke={color} strokeWidth="1.4" />
          <text x="60" y="16" textAnchor="middle" fontSize="11" fill={color} fontFamily="var(--font-mono)">?</text>
        </>
      )}
      {verdict === "does_not_meet" && (
        <>
          <motion.path d="M6 12 H46" stroke={color} strokeWidth="1.6" fill="none" {...draw} />
          <motion.path d="M74 12 H114" stroke={color} strokeWidth="1.6" fill="none" {...draw} />
          <path d="M55 7 L65 17 M65 7 L55 17" stroke={color} strokeWidth="1.8" />
          <circle cx="114" cy="12" r="3" fill={color} />
        </>
      )}
    </svg>
  );
}
