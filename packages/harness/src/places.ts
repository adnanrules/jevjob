// US places, from the Census Bureau (see scripts/build-places.ts): turn "NYC" or "Raleigh, NC" into a point, pull the
// places out of a posting's location text ("US-IL-Chicago", "Chicago, Illinois, United States of America", "Hoboken, NJ;
// Remote"), and measure distances. geography.ts builds "near you" on top of this, for any US city, no hand-made lists.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fromRoot } from "./paths";

export interface Place {
  name: string;
  state: string;
  lat: number;
  lon: number;
  pop: number;
  /** P: a city, town or census-designated place. S: a township (real in NJ, New England, PA…, but not a search term). */
  kind: "P" | "S";
}

/** Where a search is centered: a point (a city), or a whole state ("jobs in Texas"). */
export type Home = { kind: "point"; place: Place } | { kind: "state"; state: string };

/** What a posting's location text says, one entry per listed location. */
export interface Spot {
  state?: string;
  place?: Place;
}

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
const STATE_BY_NAME = new Map(Object.entries(STATE_NAMES).map(([abbr, name]) => [name.toLowerCase(), abbr]));

/** What people type that isn't a Census place name. */
const ALIASES: Record<string, [string, string]> = {
  nyc: ["New York", "NY"], "new york city": ["New York", "NY"], manhattan: ["New York", "NY"], brooklyn: ["New York", "NY"],
  queens: ["New York", "NY"], bronx: ["New York", "NY"], "the bronx": ["New York", "NY"], "staten island": ["New York", "NY"],
  sf: ["San Francisco", "CA"], "san fran": ["San Francisco", "CA"], "bay area": ["San Francisco", "CA"],
  "silicon valley": ["San Jose", "CA"], la: ["Los Angeles", "CA"], dc: ["Washington", "DC"], "washington dc": ["Washington", "DC"],
  "washington d.c.": ["Washington", "DC"], philly: ["Philadelphia", "PA"], vegas: ["Las Vegas", "NV"], nola: ["New Orleans", "LA"],
  dfw: ["Dallas", "TX"], "twin cities": ["Minneapolis", "MN"], "research triangle": ["Durham", "NC"], rtp: ["Durham", "NC"],
  "research triangle park": ["Durham", "NC"], "kansas city": ["Kansas City", "MO"], "new york": ["New York", "NY"],
};

/** Words that are also tiny Census places ("Remote, OR"), never read as a place without a state beside them. */
const NOT_A_PLACE = new Set([
  "remote", "hybrid", "onsite", "on-site", "office", "home", "united", "states", "america", "usa", "us", "multiple", "locations",
  "location", "anywhere", "virtual", "field", "headquarters", "hq", "north", "south", "east", "west", "central", "downtown",
  "county", "any", "state", "flexible", "various", "nationwide", "global", "worldwide", "campus", "metro", "area", "greater",
]);

let index: { byKey: Map<string, Place>; byName: Map<string, Place[]> } | null = null;

/** One spelling per name: lowercase, no periods, "Saint"/"St." → "st" ("St. Louis" = "Saint Louis" = "St Louis"). */
export const norm = (name: string) => name.toLowerCase().replace(/\./g, "").replace(/\b(saint|ste?)\s+/g, "st ").replace(/\s+/g, " ").trim();

function load() {
  if (index) return index;
  const rows = gunzipSync(readFileSync(fromRoot("packages", "harness", "data", "us-places.tsv.gz"))).toString("utf8").split("\n").slice(1);
  const byKey = new Map<string, Place>();
  const byName = new Map<string, Place[]>();
  for (const row of rows) {
    const [name, state, lat, lon, pop, kind] = row.split("\t");
    if (!name || !state) continue;
    const place: Place = { name, state, lat: Number(lat), lon: Number(lon), pop: Number(pop) || 0, kind: kind === "S" ? "S" : "P" };
    byKey.set(`${norm(name)}|${state}`, place);
    const list = byName.get(norm(name)) ?? [];
    list.push(place);
    byName.set(norm(name), list);
  }
  for (const list of byName.values()) list.sort((a, b) => b.pop - a.pop);
  return (index = { byKey, byName });
}

export function place(name: string, state: string): Place | undefined {
  return load().byKey.get(`${norm(name)}|${state.toUpperCase()}`);
}

/** Miles between two places (great-circle). */
export function miles(a: Pick<Place, "lat" | "lon">, b: Pick<Place, "lat" | "lon">): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const stateOf = (text: string): string | undefined => {
  const t = text.trim();
  if (/^[A-Za-z]{2}$/.test(t) && STATE_NAMES[t.toUpperCase()]) return t.toUpperCase();
  return STATE_BY_NAME.get(t.toLowerCase());
};

/** The user's location → a point or a state. "NYC", "Chicago", "Raleigh, NC", "Austin, Texas", "Texas", "the Bay Area". */
export function resolveHome(text: string): Home | null {
  // Nicknames first, before "area"/"metro" are stripped ("the Bay Area" is San Francisco, not a town called Bay).
  const typed = text.toLowerCase().trim().replace(/^the\s+/, "").replace(/[.,\s]+$/, "");
  const cleaned = typed.replace(/\b(greater|metro|area|region)\b/g, " ").replace(/\s+/g, " ").trim();
  const alias = ALIASES[typed] ?? ALIASES[cleaned];
  if (alias) {
    const p = place(...alias);
    if (p) return { kind: "point", place: p };
  }
  const [cityPart = "", regionPart = ""] = cleaned.split(",").map((s) => s.trim());
  if (!regionPart) {
    const state = stateOf(cityPart);
    // "Washington" and "New York" are states and cities; as a whole request, the state wins unless it's an alias above.
    if (state) return { kind: "state", state };
  }
  const region = regionPart ? stateOf(regionPart.split(/\s+/).slice(0, 3).join(" ")) ?? stateOf(regionPart.split(/\s+/)[0]!) : undefined;
  if (region) {
    const p = place(cityPart, region);
    return p ? { kind: "point", place: p } : { kind: "state", state: region };
  }
  const best = load().byName.get(norm(cityPart))?.[0];
  return best ? { kind: "point", place: best } : null;
}

/**
 * The US places a posting's location text names. Handles "City, ST", "City, State, Country", Workday's
 * "US-IL-Chicago" and "USA - California - San Jose", and several locations separated by ";", "|" or " or ".
 */
export function locate(text: string): Spot[] {
  const { byName } = load();
  const spots: Spot[] = [];
  const segments = text
    .replace(/\b([A-Z]{2})-(?=[A-Za-z])/g, "$1, ") // US-IL-Chicago → US, IL, Chicago
    .replace(/\s+[-–—]+\s+/g, ", ") // California - San Jose
    .split(/\s*(?:;|\||\n|\s\/\s)\s*|\s+or\s+/); // lowercase " or " only: "Portland, OR" is Oregon
  for (const segment of segments) {
    const tokens = segment.split(/[\s,()]+/).map((t) => t.replace(/^[.'’]+|[.'’:]+$/g, "")).filter(Boolean);
    if (!tokens.length) continue;
    // States: two-letter codes must be capitals ("in", "or", "me" are words); full names any case.
    const states = new Set<string>();
    for (let n = 3; n >= 1; n--) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const words = tokens.slice(i, i + n);
        const phrase = words.join(" ");
        if (n === 1 && /^[A-Z]{2}$/.test(phrase) && STATE_NAMES[phrase]) states.add(phrase);
        const byName = STATE_BY_NAME.get(phrase.toLowerCase());
        if (byName && byName !== "DC") states.add(byName);
      }
    }
    // Places: longest phrases first; each token is used once.
    const used = new Array(tokens.length).fill(false);
    const found: Place[] = [];
    for (let n = 4; n >= 1; n--) {
      for (let i = 0; i + n <= tokens.length; i++) {
        if (used.slice(i, i + n).some(Boolean)) continue;
        const phrase = norm(tokens.slice(i, i + n).join(" "));
        if (n === 1 && (NOT_A_PLACE.has(phrase) || phrase.length < 3 || /^[A-Z]{2}$/.test(tokens[i]!))) continue;
        const candidates = byName.get(phrase);
        if (!candidates) continue;
        const inState = states.size ? candidates.find((c) => states.has(c.state)) : undefined;
        // Without a state beside it, only a big city is unambiguous ("Chicago", yes; "Springfield", no).
        const pick = inState ?? (!states.size && candidates[0]!.pop >= 50_000 ? candidates[0] : undefined);
        if (!pick) continue;
        found.push(pick);
        for (let k = i; k < i + n; k++) used[k] = true;
      }
    }
    // "Albany, New York": "New York" is the state here, not a second city.
    const real = found.length > 1 ? found.filter((p) => STATE_BY_NAME.get(p.name.toLowerCase()) === undefined || !states.has(STATE_BY_NAME.get(p.name.toLowerCase())!)) : found;
    if (real.length) real.forEach((p) => spots.push({ state: p.state, place: p }));
    else states.forEach((state) => spots.push({ state }));
  }
  return spots;
}

/**
 * The biggest cities around a point, to search next: cities (not townships) of 50k+ people, at least `fromHome` miles
 * out and `apart` miles from each other, so each search covers new ground.
 */
export function nearbyCities(home: Place, radius: number, count: number, fromHome = 10, apart = 12): Place[] {
  const all = [...new Set(load().byKey.values())]
    .filter((p) => p.kind === "P" && p.pop >= 50_000 && miles(p, home) >= fromHome && miles(p, home) <= radius)
    .sort((a, b) => b.pop - a.pop);
  const picked: Place[] = [];
  for (const p of all) {
    if (picked.length >= count) break;
    if (picked.every((q) => miles(p, q) >= apart)) picked.push(p);
  }
  return picked;
}
