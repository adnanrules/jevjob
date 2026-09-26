// Search plans. In a harness, the chat model writes the plan from plain English ("junior SWE in Chicago, last
// week"): it knows which titles employers use and which suburbs "Chicago" means. Without a model (the CLI),
// planFromQuery makes a reasonable plan from keywords. Everything here is pure and unit-tested.

export type Level = "entry" | "mid" | "senior" | "any";

export const POSTED_WINDOWS = { "24h": 1, "7d": 7, "30d": 30, "3month": 90 } as const;
export type PostedWindow = keyof typeof POSTED_WINDOWS;

export interface SearchPlan {
  /** Job titles as employers write them; a posting matches if its title contains every word of any one. */
  titles: string[];
  level: Level;
  /** Cities or areas, suburbs included. Empty means anywhere. */
  locations: string[];
  /** Also accept remote postings. */
  remote: boolean;
  posted?: PostedWindow | undefined;
  /** How many postings this plan should load. */
  count: number;
  internships?: boolean | undefined;
}

const ENTRY = String.raw`\b(junior|jr\.?|entry[- ]level|entry|new[- ]grad(uate)?|graduate|early[- ]career|associate)\b`;
const SENIOR = String.raw`\b(senior|sr\.?|staff|principal|lead)\b`;

/** Common ways employers title the same job. Unknown roles fall back to the phrase itself. */
const ROLE_TITLES: Record<string, string[]> = {
  "software engineer": [
    "software engineer", "software developer", "software development engineer", "application developer",
    "applications developer", "full stack", "fullstack", "backend engineer", "back end engineer", "frontend engineer",
    "front end engineer", "web developer", "java developer", "python developer", "net developer", "programmer", "swe",
  ],
  "data analyst": ["data analyst", "business intelligence analyst", "bi analyst", "reporting analyst", "analytics analyst", "data analytics"],
  "data engineer": ["data engineer", "analytics engineer", "etl developer", "data platform engineer"],
  "data scientist": ["data scientist", "machine learning scientist", "applied scientist"],
  "machine learning engineer": ["machine learning engineer", "ml engineer", "ai engineer", "applied ai engineer", "mlops engineer"],
  "ai engineer": ["ai engineer", "applied ai engineer", "machine learning engineer", "ml engineer", "llm engineer", "genai engineer"],
  "it support": ["it support", "help desk", "helpdesk", "desktop support", "service desk", "technical support", "it specialist", "it technician", "support technician"],
  "qa engineer": ["qa engineer", "quality assurance engineer", "test engineer", "sdet", "software engineer in test", "qa analyst"],
  "devops engineer": ["devops engineer", "site reliability engineer", "sre", "platform engineer", "cloud engineer", "infrastructure engineer"],
};
const ALIASES: Record<string, string> = {
  "software developer": "software engineer", swe: "software engineer", developer: "software engineer", programmer: "software engineer",
  "ml engineer": "machine learning engineer", "help desk": "it support", "it specialist": "it support", "technical support": "it support",
  sre: "devops engineer", "site reliability engineer": "devops engineer", "business intelligence analyst": "data analyst",
};

/** Suburbs and nearby cities people mean when they name a metro. The chat model does this better; this is the CLI fallback. */
export const METROS: Record<string, string[]> = {
  chicago: [
    "chicago", "evanston", "skokie", "oak brook", "oakbrook", "naperville", "schaumburg", "deerfield", "northbrook",
    "glenview", "rosemont", "itasca", "lincolnshire", "vernon hills", "downers grove", "lake forest", "north chicago",
    "mettawa", "riverwoods", "elk grove village", "hoffman estates", "arlington heights", "des plaines", "park ridge",
    "lombard", "wheaton", "aurora", "rolling meadows", "bannockburn", "libertyville", "buffalo grove", "northfield",
    "oak park", "bolingbrook", "lisle", "warrenville", "waukegan", "mount prospect", "wood dale", "westchester",
  ],
};

/** Keyword fallback for the CLI: "junior software engineer" → entry level, software-engineer titles. */
export function planFromQuery(
  query: string,
  opts: { location?: string | undefined; remote?: boolean | undefined; posted?: PostedWindow | undefined; count?: number | undefined } = {},
): SearchPlan {
  const q = query.toLowerCase();
  const level: Level = new RegExp(ENTRY, "i").test(q) ? "entry" : new RegExp(SENIOR, "i").test(q) ? "senior" : "any";
  const internships = /\bintern(ship)?s?\b/.test(q);
  const role =
    q
      .replace(new RegExp(ENTRY, "gi"), " ")
      .replace(new RegExp(SENIOR, "gi"), " ")
      .replace(/\b(intern(ship)?s?|jobs?|roles?|positions?)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/s$/, "") || "software engineer";
  const canonical = ALIASES[role] ?? role;
  const place = opts.location?.toLowerCase().trim();
  return {
    titles: ROLE_TITLES[canonical] ?? [role],
    level,
    locations: place ? (METROS[place] ?? [place]) : [],
    remote: Boolean(opts.remote),
    posted: opts.posted,
    count: opts.count ?? 25,
    internships,
  };
}

const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|manager|director|head|architect|vp|distinguished|fellow|chief)\b/i;
const LEVEL_NUMBER = /\b(ii|iii|iv|v|2|3|4|5)\b(?!\s*(\+|years))/i;
const ENTRY_TITLE = /\b(junior|jr\.?|entry[- ]level|new[- ]grad|graduate|early[- ]career|associate|apprentice|trainee|level\s*1|i)\b/i;
const INTERN_TITLE = /\b(intern|internship|co-?op)\b/i;

/** How well a title fits the plan's level: null excludes it, higher is a better fit. */
export function levelFit(title: string, plan: Pick<SearchPlan, "level" | "internships">): number | null {
  if (INTERN_TITLE.test(title) && !plan.internships) return null;
  switch (plan.level) {
    case "entry":
      if (SENIOR_TITLE.test(title) || LEVEL_NUMBER.test(title)) return null;
      return ENTRY_TITLE.test(title) ? 2 : 1;
    case "mid":
      return SENIOR_TITLE.test(title) || /\b(junior|jr\.?|new[- ]grad)\b/i.test(title) ? null : 1;
    case "senior":
      return /\b(senior|sr\.?|staff|principal|lead)\b/i.test(title) ? 2 : null;
    default:
      return 1;
  }
}

const STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co", connecticut: "ct", delaware: "de",
  florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky",
  louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
  missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm",
  "new york": "ny", "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa",
  "rhode island": "ri", "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};

export type LocationFit = "match" | "unknown" | "no";

/** Does a posting's location satisfy the plan? "unknown" when the text doesn't say (placeholders, blank). */
export function locationFit(jobLocation: string | null | undefined, plan: Pick<SearchPlan, "locations" | "remote">): LocationFit {
  const text = (jobLocation ?? "").toLowerCase();
  if (!text.trim() || /^\s*\d+\s+locations?\s*$/.test(text)) return "unknown";
  if (plan.remote && /\b(remote|anywhere|work from home|virtual)\b/.test(text)) return "match";
  if (plan.locations.length === 0) return plan.remote ? "no" : "match";
  const hit = plan.locations.some((place) => {
    const p = place.toLowerCase().replace(/,.*$/, "").trim();
    const state = STATES[p];
    return text.includes(p) || (state !== undefined && new RegExp(`,\\s*${state}\\b`).test(text));
  });
  return hit ? "match" : "no";
}
