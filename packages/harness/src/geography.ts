// Where to look, in order, and which postings each place accepts.
//   The requested city → nearby cities → the rest of the state → remote (anywhere in the US).
// Outside the home state only remote postings count, and in-state postings always come first.

import { METROS, STATES, type SearchPlan } from "./intent";

export interface SearchArea {
  /** Shown to the user and passed back with results. */
  label: string;
  /** What to type into a job board's location box: "Chicago, IL", "Illinois", "remote". */
  query: string;
  /** Out-of-state areas: only remote postings are accepted. */
  remoteOnly: boolean;
}

/** Cities that anchor each metro's nearby-city stage: spread out, so each board search covers new ground. */
const NEARBY: Record<string, string[]> = {
  chicago: ["Naperville", "Schaumburg", "Evanston", "Oak Brook", "Deerfield", "Joliet"],
  "new york": ["Jersey City", "Newark", "Stamford", "White Plains"],
  "san francisco": ["San Jose", "Oakland", "Palo Alto", "Mountain View"],
  seattle: ["Bellevue", "Redmond", "Tacoma"],
  boston: ["Cambridge", "Waltham", "Burlington"],
  austin: ["Round Rock", "San Marcos", "Georgetown"],
};

const CITY_STATES: Record<string, string> = {
  chicago: "illinois", evanston: "illinois", naperville: "illinois", schaumburg: "illinois", "new york": "new york",
  boston: "massachusetts", seattle: "washington", austin: "texas", dallas: "texas", houston: "texas",
  "san francisco": "california", "los angeles": "california", "san jose": "california", denver: "colorado",
  atlanta: "georgia", miami: "florida", detroit: "michigan", minneapolis: "minnesota", phoenix: "arizona",
  philadelphia: "pennsylvania", columbus: "ohio", indianapolis: "indiana", milwaukee: "wisconsin", "st. louis": "missouri",
};

const title = (s: string) => s.replace(/\b\w/g, (x) => x.toUpperCase());

/** The home state implied by the plan's first location, or null when the plan has no place (or a remote-only plan). */
export function homeState(plan: Pick<SearchPlan, "locations">): string | null {
  const first = plan.locations[0]?.toLowerCase().trim();
  if (!first) return null;
  const [city = "", region = ""] = first.split(",").map((s) => s.trim());
  const fromRegion = Object.entries(STATES).find(([name, abbr]) => region === name || region === abbr)?.[0];
  return fromRegion ?? CITY_STATES[city] ?? (STATES[city] ? city : null);
}

export function searchAreas(plan: SearchPlan): SearchArea[] {
  const state = homeState(plan);
  const first = plan.locations[0]?.split(",")[0]?.trim().toLowerCase();
  if (!first) return [{ label: plan.remote ? "Remote" : "Anywhere", query: plan.remote ? "remote" : "United States", remoteOnly: plan.remote }];
  const abbr = state ? STATES[state]!.toUpperCase() : "";
  const at = (city: string) => (abbr ? `${title(city)}, ${abbr}` : title(city));
  const areas: SearchArea[] = [];
  if (first !== state) areas.push({ label: title(first), query: at(first), remoteOnly: false });
  if (plan.locationMode !== "strict") {
    for (const city of NEARBY[first] ?? []) areas.push({ label: `Near ${title(first)}: ${city}`, query: at(city), remoteOnly: false });
    if (state) areas.push({ label: title(state), query: title(state), remoteOnly: false });
    areas.push({ label: "Remote (US)", query: "remote", remoteOnly: true });
  } else if (plan.remote) {
    areas.push({ label: "Remote (US)", query: "remote", remoteOnly: true });
  }
  return areas;
}

export type Placement = "home" | "remote" | "unknown" | "no";

const REMOTE = /\b(remote|work from home|telecommute|anywhere)\b/i;
const NOT_REMOTE = /\b(hybrid|on[- ]?site|in[- ]office)\b/i;
/** Remote postings tied to another country or region ("Argentina Remote", "Remote - EMEA") aren't US-remote. */
const FOREIGN = /\b(canada|united kingdom|uk|england|india|mexico|germany|philippines|poland|brazil|ireland|australia|argentina|colombia|chile|peru|uruguay|costa rica|spain|portugal|france|netherlands|italy|sweden|romania|ukraine|israel|pakistan|nigeria|kenya|south africa|japan|singapore|china|vietnam|emea|apac|latam|europe)\b/i;

/**
 * Where a posting sits relative to the plan: in the home state or metro ("home"), acceptable only because it's
 * remote ("remote"), not stated ("unknown"), or out of bounds ("no"). Onsite jobs in other states are never accepted.
 */
export function placement(jobLocation: string | null | undefined, plan: SearchPlan): Placement {
  const text = (jobLocation ?? "").trim();
  const lower = text.toLowerCase();
  if (!text || /^\d+\s+locations?$/i.test(text)) return "unknown";
  const remote = REMOTE.test(text) && !NOT_REMOTE.test(text) && !FOREIGN.test(text);
  if (!plan.locations.length) return plan.remote ? (remote ? "remote" : "no") : "home";

  const state = homeState(plan);
  const metro = new Set([...plan.locations.map((l) => l.toLowerCase().split(",")[0]!.trim()), ...(METROS[plan.locations[0]!.toLowerCase().split(",")[0]!.trim()] ?? [])]);
  const inMetro = [...metro].some((city) => city && lower.includes(city));
  const inState = state ? lower.includes(state) || new RegExp(`(^|,|\\s)${STATES[state]}(\\b|$)`, "i").test(text) : false;
  if (inMetro || inState) return "home";
  return remote && (plan.remote || plan.locationMode !== "strict") ? "remote" : "no";
}
