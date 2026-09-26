// Where to look, in order, and which postings each place accepts. Works for any US city or state (places.ts).
//
//   near    within a commuting radius of the requested city (50 miles unless the request says otherwise), in any
//           state: Jersey City counts for New York, and Gary, Indiana for Chicago
//   state   elsewhere in the same state (a wider net, after the radius)
//   remote  US-remote postings, from anywhere
//   no      onsite somewhere else, or remote but tied to another country
//
// Search order for boards like Indeed: the city → the largest cities within the radius → the state → remote.

import { type SearchPlan } from "./intent";
import { locate, miles, nearbyCities, resolveHome, STATE_NAMES, type Home } from "./places";

/** A commute, not a relocation. Requests can override it ("within 25 miles"). */
export const DEFAULT_RADIUS_MILES = 50;

export interface SearchArea {
  /** Shown to the user and passed back with results. */
  label: string;
  /** What to type into a job board's location box: "Chicago, IL", "Illinois", "remote". */
  query: string;
  /** Remote-only areas accept only remote postings. */
  remoteOnly: boolean;
}

export type Placement = "near" | "state" | "remote" | "unknown" | "no";

/** Best first, for sorting: near, then the rest of the state, then remote, then unknown. */
export const placeRank = (p: Placement): number => ({ near: 3, state: 2, remote: 1, unknown: 0, no: -1 })[p];

export const radiusOf = (plan: Pick<SearchPlan, "radiusMiles">) => plan.radiusMiles ?? DEFAULT_RADIUS_MILES;

export function homeOf(plan: Pick<SearchPlan, "locations">): Home | null {
  return plan.locations[0] ? resolveHome(plan.locations[0]) : null;
}

/** The home state's name ("Illinois"), or null when the plan has no place. */
export function homeState(plan: Pick<SearchPlan, "locations">): string | null {
  const home = homeOf(plan);
  if (!home) return null;
  return STATE_NAMES[home.kind === "point" ? home.place.state : home.state] ?? null;
}

const remoteArea: SearchArea = { label: "Remote (US)", query: "remote", remoteOnly: true };

export function searchAreas(plan: SearchPlan): SearchArea[] {
  const home = homeOf(plan);
  if (!plan.locations.length) return [{ label: plan.remote ? "Remote" : "Anywhere", query: plan.remote ? "remote" : "United States", remoteOnly: plan.remote }];
  const strict = plan.locationMode === "strict";
  if (!home) {
    // Not a US place we know: search it as typed, and remote when widening.
    return [{ label: plan.locations[0]!, query: plan.locations[0]!, remoteOnly: false }, ...(strict && !plan.remote ? [] : [remoteArea])];
  }
  if (home.kind === "state") {
    const name = STATE_NAMES[home.state]!;
    return [{ label: name, query: name, remoteOnly: false }, ...(strict && !plan.remote ? [] : [remoteArea])];
  }
  const { place } = home;
  const at = (p: { name: string; state: string }) => `${p.name}, ${p.state}`;
  const areas: SearchArea[] = [{ label: place.name, query: at(place), remoteOnly: false }];
  if (!strict) {
    for (const city of nearbyCities(place, radiusOf(plan), 3)) {
      areas.push({ label: `Near ${place.name}: ${city.name}, ${city.state}`, query: at(city), remoteOnly: false });
    }
    if (place.state !== "DC") areas.push({ label: STATE_NAMES[place.state]!, query: STATE_NAMES[place.state]!, remoteOnly: false });
    areas.push(remoteArea);
  } else if (plan.remote) {
    areas.push(remoteArea);
  }
  return areas;
}

const REMOTE = /\b(remote|work from home|telecommute|anywhere)\b/i;
const NOT_REMOTE = /\b(hybrid|on[- ]?site|in[- ]office)\b/i;
/** Remote postings tied to another country or region ("Argentina Remote", "Remote - EMEA") aren't US-remote. */
const FOREIGN = /\b(canada|united kingdom|uk|england|india|mexico|germany|philippines|poland|brazil|ireland|australia|argentina|colombia|chile|peru|uruguay|costa rica|spain|portugal|france|netherlands|italy|sweden|romania|ukraine|israel|pakistan|nigeria|kenya|south africa|japan|singapore|china|vietnam|emea|apac|latam|europe)\b/i;

/** Where a posting sits relative to the plan (see the top of this file). */
export function placement(jobLocation: string | null | undefined, plan: SearchPlan): Placement {
  const text = (jobLocation ?? "").trim();
  if (!text || /^\d+\s+locations?$/i.test(text)) return "unknown";
  const remote = REMOTE.test(text) && !NOT_REMOTE.test(text) && !FOREIGN.test(text);
  const strict = plan.locationMode === "strict";
  const remoteOk = remote && (plan.remote || !strict);
  if (!plan.locations.length) return plan.remote ? (remote ? "remote" : "no") : "near";

  const home = homeOf(plan);
  if (!home) {
    // Somewhere we can't place on a map: fall back to the words themselves.
    if (text.toLowerCase().includes(plan.locations[0]!.toLowerCase().split(",")[0]!.trim())) return "near";
    return remoteOk ? "remote" : "no";
  }
  const spots = locate(text);
  const homeStateCode = home.kind === "point" ? home.place.state : home.state;
  if (home.kind === "state" ? spots.some((s) => s.state === home.state) : spots.some((s) => s.place && miles(s.place, home.place) <= radiusOf(plan))) {
    return "near";
  }
  if (!strict && home.kind === "point" && spots.some((s) => s.state === homeStateCode)) return "state";
  if (remoteOk) return "remote";
  // No place in it at all, just a placeholder: the full posting may say more.
  if (!spots.length && /\b(multiple|various|several|tbd|to be determined|see (?:description|posting))\b/i.test(text)) return "unknown";
  return "no";
}
