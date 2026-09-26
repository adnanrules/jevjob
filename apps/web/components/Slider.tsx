"use client";
import { aggressivenessLabel } from "@/lib/tiers";

/** Moves only the policy, so the board re-ranks instantly without new model calls. */
export function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="slider-wrap">
      <span>Conservative</span>
      <input
        className="slider"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--pct" as string]: `${value * 100}%` }}
        aria-label="How aggressively to apply"
        aria-valuetext={aggressivenessLabel(value)}
      />
      <span>Apply anyway</span>
    </label>
  );
}
