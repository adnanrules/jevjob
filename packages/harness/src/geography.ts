import { locationFit, METROS, STATES, type SearchPlan } from "./intent";

export interface SearchArea {
  label: string;
  locations: string[];
  remote: boolean;
  usRemoteOnly?: boolean;
}

// Explicit geography, never a company allowlist. Unknown cities remain strict rather than guessing a state.
const CITY_STATES: Record<string, string> = {
  chicago: "illinois", evanston: "illinois", skokie: "illinois", naperville: "illinois", schaumburg: "illinois",
  "new york": "new york", boston: "massachusetts", seattle: "washington", austin: "texas", dallas: "texas",
  houston: "texas", "san francisco": "california", "los angeles": "california", denver: "colorado", atlanta: "georgia",
  miami: "florida", detroit: "michigan", minneapolis: "minnesota", phoenix: "arizona", philadelphia: "pennsylvania",
};
const NEIGHBORS: Record<string, string[]> = {
  illinois: ["wisconsin", "indiana", "iowa", "missouri", "kentucky"],
  wisconsin: ["illinois", "iowa", "minnesota", "michigan"],
  indiana: ["illinois", "michigan", "ohio", "kentucky"],
  iowa: ["illinois", "wisconsin", "minnesota", "south dakota", "nebraska", "missouri"],
  missouri: ["illinois", "iowa", "nebraska", "kansas", "oklahoma", "arkansas", "tennessee", "kentucky"],
  kentucky: ["illinois", "indiana", "ohio", "west virginia", "virginia", "tennessee", "missouri"],
  "new york": ["new jersey", "pennsylvania", "connecticut", "massachusetts", "vermont"],
  massachusetts: ["new york", "vermont", "new hampshire", "connecticut", "rhode island"],
  washington: ["oregon", "idaho"], texas: ["new mexico", "oklahoma", "arkansas", "louisiana"],
  california: ["oregon", "nevada", "arizona"], colorado: ["wyoming", "nebraska", "kansas", "oklahoma", "new mexico", "arizona", "utah"],
  georgia: ["florida", "alabama", "tennessee", "north carolina", "south carolina"],
  florida: ["georgia", "alabama"], michigan: ["wisconsin", "indiana", "ohio"],
  minnesota: ["wisconsin", "iowa", "south dakota", "north dakota"],
  arizona: ["california", "nevada", "utah", "colorado", "new mexico"],
  pennsylvania: ["new york", "new jersey", "delaware", "maryland", "west virginia", "ohio"],
};
const pretty = (s: string) => s.replace(/\b\w/g, (x) => x.toUpperCase());

export function searchAreas(plan: SearchPlan): SearchArea[] {
  const requested: SearchArea = { label: plan.locations.join(", ") || (plan.remote ? "Remote" : "Anywhere"), locations: plan.locations, remote: plan.remote };
  if (plan.locationMode === "strict" || plan.locations.length === 0) return [requested];
  const first = plan.locations[0]!.toLowerCase().trim().replace(/^greater\s+|\s+(?:metro|metropolitan|area)(?:\s+area)?$/g, "");
  const [city = "", region = ""] = first.split(",").map((s) => s.trim());
  const stateFromRegion = Object.entries(STATES).find(([name, abbr]) => region === name || region === abbr)?.[0];
  const state = stateFromRegion ?? CITY_STATES[city] ?? (STATES[city] ? city : undefined);
  if (!state) return [requested];
  const knownMetro = METROS[city];
  if (plan.locations.length > 1 && plan.locations.some((p) => !knownMetro?.includes(p.toLowerCase()))) return [requested];
  const areas: SearchArea[] = [];
  if (city !== state) {
    areas.push({ label: pretty(city), locations: [city], remote: plan.remote });
    const metro = METROS[city];
    if (metro || plan.locations.length > 1) areas.push({ label: `${pretty(city)} area`, locations: [...new Set([...(metro ?? []), ...plan.locations])], remote: plan.remote });
  }
  areas.push({ label: pretty(state), locations: [state], remote: false });
  if (NEIGHBORS[state]) areas.push({ label: `States surrounding ${pretty(state)}`, locations: NEIGHBORS[state]!, remote: false });
  areas.push({ label: "United States (remote only)", locations: [], remote: true, usRemoteOnly: true });
  return areas;
}

export function areaFit(location: string, area: SearchArea): boolean {
  if (area.usRemoteOnly) {
    return /\b(?:remote|work from home|telecommute)\b/i.test(location)
      && /\b(?:united states(?: of america)?|u\.?s\.?a?\.?|worldwide|global)\b/i.test(location)
      && !/\b(?:hybrid|on[- ]?site|not remote|except (?:the )?u\.?s|excluding (?:the )?united states)\b/i.test(location);
  }
  // Do not pass an onsite job nationwide merely because it appeared in a remote search.
  if (!area.locations.length && !area.remote) return true;
  return locationFit(location, area) === "match";
}
