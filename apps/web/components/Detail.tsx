"use client";
import { useEffect } from "react";
import { motion } from "motion/react";
import { worstVerdict, type Assessment, type RankedJob, type Requirement, type Verdict } from "@jevjob/core";
import { TIERS, VERDICTS } from "@/lib/tiers";

interface Line {
  text: string;
  importance: Requirement["importance"];
  verdict: Verdict;
  evidence: string | null;
  confidence: number | null;
}

/** One row per posting line ("TypeScript and React" held two requirements; show it once, worst verdict). */
function linesOf(r: RankedJob): Line[] {
  const byId = new Map(r.assessments.map((a) => [a.requirementId, a]));
  const groups = new Map<string, Array<{ req: Requirement; a: Assessment | undefined }>>();
  for (const req of r.requirements) groups.set(req.text, [...(groups.get(req.text) ?? []), { req, a: byId.get(req.id) }]);
  return [...groups.entries()].map(([text, items]) => {
    const assessments = items.map((i) => i.a).filter((a): a is Assessment => Boolean(a));
    const confidences = assessments.filter((a) => a.source === "jev" && a.confidence !== null).map((a) => a.confidence!);
    return {
      text,
      importance: items[0]!.req.importance,
      verdict: worstVerdict(assessments.map((a) => a.verdict)),
      evidence: assessments.find((a) => a.evidence)?.evidence ?? null,
      confidence: confidences.length ? Math.min(...confidences) : null,
    };
  });
}

const PLACEHOLDER: Record<Verdict, string> = {
  meets: "on your resume",
  unclear: "not stated",
  does_not_meet: "not on your resume",
};

export function Detail({ r, onClose }: { r: RankedJob; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tier = TIERS[r.tier];
  const lines = linesOf(r);
  const { required: req, preferred: pref } = r.coverage;
  const confidences = r.assessments.filter((a) => a.source === "jev" && a.confidence !== null).map((a) => a.confidence!);
  const avg = confidences.length ? confidences.reduce((s, c) => s + c, 0) / confidences.length : null;
  const blockerIds = new Set(r.blockers.map((b) => b.requirementId));
  const blockers = [...new Set(r.requirements.filter((q) => blockerIds.has(q.id)).map((q) => q.text))];

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
        transition={{ type: "spring", stiffness: 320, damping: 38 }}
      >
        <div className="d-head">
          <div className="rank">{r.rank}</div>
          <div>
            <h3>{r.job.title}</h3>
            <p>{r.job.company}{r.job.location ? ` · ${r.job.location}` : ""}</p>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="d-stats">
          <div><b style={{ color: tier.color }}>{tier.label}</b>verdict</div>
          <div><b>{req.met}/{req.total}</b>required met{req.unclear ? `, ${req.unclear} unclear` : ""}</div>
          <div><b>{pref.met}/{pref.total}</b>preferred met</div>
          {avg !== null && <div><b>{Math.round(avg * 100)}%</b>Jev confidence</div>}
        </div>

        {blockers.length > 0 && <p className="blocker">Blocked by: {blockers.join("; ")}</p>}

        {(["required", "preferred"] as const).map((importance) => {
          const group = lines.filter((l) => l.importance === importance);
          if (!group.length) return null;
          return (
            <div className="d-group" key={importance}>
              <h4>{importance}</h4>
              {group.map((l, i) => (
                <motion.div
                  key={l.text}
                  className="crow"
                  style={{ ["--vc" as string]: VERDICTS[l.verdict].color }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1 + i * 0.03 }}
                >
                  <div className={`ev${l.evidence ? "" : " none"}`}>{l.evidence ?? PLACEHOLDER[l.verdict]}</div>
                  <Wire verdict={l.verdict} delay={0.15 + i * 0.03} />
                  <div className="req">
                    <span>{l.text}</span>
                    {l.confidence !== null && <small title="Jev's confidence in this verdict">{Math.round(l.confidence * 100)}%</small>}
                  </div>
                </motion.div>
              ))}
            </div>
          );
        })}

        <div className="d-foot">
          <a className="btn" href={r.job.applyUrl} target="_blank" rel="noopener noreferrer">Apply on {r.job.company}&rsquo;s site ↗</a>
        </div>
        <p className="d-note">Percentages are Jev&rsquo;s confidence in each verdict, not a chance of being hired.</p>
      </motion.aside>
    </>
  );
}

/** Resume ↔ posting: solid when met, dashed when unclear, broken when missing. */
function Wire({ verdict, delay }: { verdict: Verdict; delay: number }) {
  const color = VERDICTS[verdict].color;
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { delay, duration: 0.4 } };
  return (
    <svg className="wire" viewBox="0 0 96 20" aria-label={VERDICTS[verdict].label}>
      {verdict === "meets" && (
        <>
          <motion.path d="M4 10 H92" stroke={color} strokeWidth="1.25" fill="none" {...draw} />
          <circle cx="4" cy="10" r="2.5" fill={color} />
          <circle cx="92" cy="10" r="2.5" fill={color} />
        </>
      )}
      {verdict === "unclear" && (
        <>
          <motion.path d="M4 10 H92" stroke={color} strokeWidth="1.25" strokeDasharray="3 4" fill="none" {...draw} />
          <circle cx="92" cy="10" r="2.5" fill={color} />
        </>
      )}
      {verdict === "does_not_meet" && (
        <>
          <motion.path d="M4 10 H38" stroke={color} strokeWidth="1.25" fill="none" opacity="0.5" {...draw} />
          <motion.path d="M58 10 H92" stroke={color} strokeWidth="1.25" fill="none" {...draw} />
          <path d="M44 6 L52 14 M52 6 L44 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="92" cy="10" r="2.5" fill={color} />
        </>
      )}
    </svg>
  );
}
