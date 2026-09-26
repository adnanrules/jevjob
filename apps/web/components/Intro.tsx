"use client";
import { useState } from "react";
import { motion } from "motion/react";

export interface Sample { key: string; name: string; headline: string; text: string }
export interface Setup { samples: Sample[]; jev: { model: string } | null; source: "harness" | "demo"; jobCount: number }

export function Intro({ setup, resume, setResume, engine, setEngine, onRun, error }: {
  setup: Setup | null;
  resume: string;
  setResume: (text: string) => void;
  engine: "rules" | "jev";
  setEngine: (e: "rules" | "jev") => void;
  onRun: () => void;
  error: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && /\.(md|txt|markdown)$/i.test(file.name)) {
      setResume(await file.text());
      setPicked(null);
    }
  };

  return (
    <div className="intro">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}>
        <div className="eyebrow">Job fit, one requirement at a time</div>
        <h1 className="hero">
          Which jobs should you <em>actually</em> apply to?
        </h1>
        <p className="lede">
          Paste a resume. JevJob pulls every requirement out of every posting, asks a small typed question about each one,
          and ranks the pool from best fit to worst. Every rank is explained line by line.
        </p>
        <div className="steps">
          <Step n="01" title="Extract">Each posting becomes a list of requirements: required or preferred, skill, degree, years, eligibility.</Step>
          <Step n="02" title="Classify">
            One bounded question per requirement, answered in a single call per job.
            <div className="q-sample">
              <span className="q-pill">meets <i>|</i> partial <i>|</i> not_stated <i>|</i> does_not_meet</span>
              <span className="q-pill">confidence 0.94</span>
            </div>
          </Step>
          <Step n="03" title="Decide">Plain code turns those answers into a tier. Moving the slider re-ranks instantly, with zero model calls.</Step>
        </div>
      </motion.div>

      <motion.div
        className="paper"
        initial={{ opacity: 0, y: 24, rotate: 0.6 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="paper-head">
          <span className="eyebrow">Try a candidate</span>
          <span className="fine" style={{ marginTop: 0 }}>all fictional</span>
        </div>
        <div className="samples" style={{ marginBottom: 12 }}>
          {setup?.samples.map((s) => (
            <button key={s.key} className="sample" aria-pressed={picked === s.key} onClick={() => { setResume(s.text); setPicked(s.key); }}>
              <b>{s.name}</b>
              <span>{s.headline}</span>
            </button>
          ))}
        </div>
        <textarea
          className="resume-input"
          value={resume}
          onChange={(e) => { setResume(e.target.value); setPicked(null); }}
          placeholder={"Paste your resume here, or drop a .md / .txt file.\n\n## Experience\n**Software Engineer Intern**, Acme. Jun 2025 – Aug 2025\n- Built…"}
          spellCheck={false}
        />
        {dragging && <div className="drop-hint">Drop to load resume</div>}
        <div className="paper-foot">
          <div className="engine" role="group" aria-label="Classifier">
            <button aria-pressed={engine === "jev"} disabled={!setup?.jev} onClick={() => setEngine("jev")}
              title={setup?.jev ? `TypeSafe ${setup.jev.model}` : "Add TYPESAFE_API_KEY to .env to enable Jev"}>
              Jev
            </button>
            <button aria-pressed={engine === "rules"} onClick={() => setEngine("rules")}>Rules</button>
          </div>
          <span className="fine" style={{ marginTop: 0 }}>
            {setup ? `${setup.jobCount} ${setup.source === "harness" ? "postings from your harness" : "demo postings"}` : "…"}
          </span>
          <button className="run-btn" disabled={!resume.trim()} onClick={onRun}>Run the machine →</button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="fine">
          {engine === "jev"
            ? "Your resume is sent to TypeSafe's Jev to classify each requirement. Nothing is stored except a local answer cache."
            : "Rules run entirely on this machine: fast, free, and noticeably less accurate. See docs/eval-log.md."}
        </div>
      </motion.div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="step">
      <span className="n">{n}</span>
      <div>
        <b>{title}</b>
        <div className="step-body">{children}</div>
      </div>
    </div>
  );
}
