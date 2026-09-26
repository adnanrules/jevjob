"use client";
import { aggressivenessLabel } from "@/lib/tiers";

/** Moves only the policy: re-ranks instantly in the browser with no API calls. */
export function Aggressiveness({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const unclearCredit = Math.round((0.25 + 0.5 * value) * 100);
  return (
    <div className="panel">
      <div className="panel-title">
        <span>APPLICATION AGGRESSIVENESS</span>
        <span>re-ranks locally · 0 API calls</span>
      </div>
      <div className="aggr-value">
        {aggressivenessLabel(value)}
        <small>an unclear requirement counts as {unclearCredit}% met</small>
      </div>
      <input
        className="slider"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Application aggressiveness"
        aria-valuetext={aggressivenessLabel(value)}
      />
      <div className="slider-ends">
        <span>Conservative</span>
        <span>Apply anyway</span>
      </div>
    </div>
  );
}
