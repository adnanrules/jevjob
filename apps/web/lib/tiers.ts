import type { Tier, Verdict } from "@jevjob/core";

export const TIERS: Record<Tier, { label: string; color: string; blurb: string }> = {
  apply: { label: "Apply", color: "var(--t-apply)", blurb: "Meets nearly every requirement" },
  maybe: { label: "Maybe", color: "var(--t-maybe)", blurb: "Most requirements, a gap or two" },
  stretch: { label: "Stretch", color: "var(--t-stretch)", blurb: "About half the requirements" },
  big_stretch: { label: "Big stretch", color: "var(--t-big)", blurb: "Misses most requirements" },
  no: { label: "No", color: "var(--t-no)", blurb: "A hard blocker" },
};

export const VERDICTS: Record<Verdict, { label: string; color: string; mark: string }> = {
  meets: { label: "You meet this", color: "var(--v-meets)", mark: "✓" },
  unclear: { label: "Unclear", color: "var(--v-unclear)", mark: "?" },
  does_not_meet: { label: "You don't meet this", color: "var(--v-miss)", mark: "✕" },
};

/** Words for the slider, because 0.73 means nothing to a person. */
export function aggressivenessLabel(a: number): string {
  if (a < 0.2) return "Conservative";
  if (a < 0.4) return "Careful";
  if (a < 0.6) return "Balanced";
  if (a < 0.8) return "Bold";
  return "Apply anyway";
}

export function monogram(company: string): string {
  const words = company.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** A stable muted hue per company, so chips are distinguishable before they're ranked. */
export function hueOf(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
