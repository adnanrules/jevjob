"use client";
import { useRef, useState } from "react";
import { motion } from "motion/react";

export interface Sample { key: string; name: string; headline: string; text: string }
export interface Setup { samples: Sample[]; jev: { model: string } | null; source: "harness" | "demo"; jobCount: number }

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";

export function Landing({ setup, onRun, error: runError, onDragChange }: {
  setup: Setup | null;
  onRun: (resumeText: string) => void;
  error: string | null;
  onDragChange: (dragging: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const drag = (on: boolean) => {
    setOver(on);
    onDragChange(on);
  };

  const readFile = async (file: File) => {
    setError(null);
    setReading(file.name);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/extract", { method: "POST", body }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { text?: string; error?: string } | null;
    setReading(null);
    if (!res?.ok || !data?.text) return setError(data?.error ?? "Couldn't read that file.");
    onRun(data.text);
  };

  const count = setup?.jobCount ?? 0;
  return (
    <motion.section
      className="landing"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      <h1 className="headline">Where should you apply?</h1>
      <p className="subline">
        {setup ? (
          <><b>{count}</b> {setup.source === "harness" ? "job listings loaded" : "sample roles (fictional)"}, ranked against your resume.</>
        ) : " "}
      </p>

      <div
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); if (!over) drag(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) drag(false); }}
        onDrop={(e) => {
          e.preventDefault();
          drag(false);
          const file = e.dataTransfer.files[0];
          if (file) void readFile(file);
        }}
      >
        {reading ? (
          <div className="reading"><span>Reading {reading}</span><span className="bar" /></div>
        ) : pasting ? (
          <>
            <textarea className="paste" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your resume" spellCheck={false} />
            <div className="drop-actions">
              <button className="btn" disabled={text.trim().length < 80} onClick={() => onRun(text)}>Rank jobs</button>
              <button className="link-btn" onClick={() => setPasting(false)}>Use a file instead</button>
            </div>
          </>
        ) : (
          <>
            <p className="drop-title">Drop your resume</p>
            <p className="drop-hint">PDF, DOCX, TXT or Markdown</p>
            <div className="drop-actions">
              <button className="btn" onClick={() => input.current?.click()}>
                <UploadIcon /> Choose file
              </button>
              <button className="link-btn" onClick={() => setPasting(true)}>Paste text</button>
            </div>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readFile(file);
          }}
        />
      </div>
      {(error ?? runError) && <p className="error">{error ?? runError}</p>}

      {setup && setup.samples.length > 0 && (
        <div className="samples">
          <span>Or try</span>
          {setup.samples.map((s) => (
            <button key={s.key} onClick={() => onRun(s.text)} aria-label={`${s.name}, ${s.headline}`}>{s.name}</button>
          ))}
        </div>
      )}
    </motion.section>
  );
}

function UploadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 11V2.5M8 2.5 4.5 6M8 2.5 11.5 6M2.5 10.5v2.25c0 .41.34.75.75.75h9.5c.41 0 .75-.34.75-.75V10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
