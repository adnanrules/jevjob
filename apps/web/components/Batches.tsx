"use client";
// Batches of up to 50. "Load 50 more" ranks the next batch when the pool already has one; otherwise it tells you the
// one line to type in Claude or Codex, and lights up by itself when those new postings arrive.
import { useState } from "react";

export function Batches({ batch, batches, poolSize, busy, onBatch }: {
  batch: number;
  batches: number;
  poolSize: number;
  busy: boolean;
  onBatch: (batch: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const hasNext = batch + 1 < batches;

  return (
    <div className="batches">
      <div className="batch-pills" role="group" aria-label="Batches">
        {Array.from({ length: batches }, (_, i) => (
          <button key={i} aria-pressed={i === batch} disabled={busy} onClick={() => onBatch(i)}>
            {i * 50 + 1}–{Math.min(poolSize, (i + 1) * 50)}
          </button>
        ))}
      </div>
      {hasNext ? (
        <button className="btn load-more" disabled={busy} onClick={() => onBatch(batch + 1)}>
          Load {Math.min(50, poolSize - (batch + 1) * 50)} more <span aria-hidden>↓</span>
        </button>
      ) : (
        <div className="more-hint">
          <span>For 50 more with the same search, ask your assistant:</span>
          <button
            className="cmd"
            onClick={() => {
              void navigator.clipboard?.writeText("/jevjob more");
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
          >
            <code>/jevjob more</code>
            <span>{copied ? "copied" : "copy"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
