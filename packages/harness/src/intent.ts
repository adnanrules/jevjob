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
  /** Explicit rolling window, in days. Takes precedence over posted. */
  days?: number | undefined;
  /** How many postings this plan should load. */
  count: number;
  internships?: boolean | undefined;
  /** Expand supported US locations in stages; strict never changes the requested geography. */
  locationMode?: "expand" | "strict" | undefined;
  /** Default: employer ATS boards plus established job boards, not arbitrary repost sites. */
  sources?: "recommended" | "employers" | "any" | undefined;
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
  opts: { location?: string | undefined; remote?: boolean | undefined; posted?: PostedWindow | undefined; days?: number | undefined; count?: number | undefined; locationMode?: "expand" | "strict" | undefined } = {},
): SearchPlan {
  let q = query.toLowerCase().trim().replace(/^\/?jevjob\s+/, "").replace(/^(?:find|search)(?:\s+for|\s+me)?\s+/, "");
  const countMatch = q.match(/^(\d+)\s+/);
  if (countMatch) q = q.slice(countMatch[0].length);
  const window = q.match(/\b(?:posted\s+)?(?:in\s+the\s+)?(?:last|past)\s+(\d+)\s*(days?|weeks?|hours?)\b/);
  const impliedDays = window ? Number(window[1]) * (/week/.test(window[2]!) ? 7 : /hour/.test(window[2]!) ? 1 / 24 : 1)
    : /\b(?:last week|this week)\b/.test(q) ? 7 : /\b(?:today|last 24h)\b/.test(q) ? 1 : /\b(?:last month|this month)\b/.test(q) ? 30 : undefined;
  q = q.replace(window?.[0] ?? /$^/, " ").replace(/\b(?:last week|this week|today|last 24h|last month|this month)\b/g, " ");
  const remote = opts.remote ?? /\bremote\b/.test(q);
  q = q.replace(/\b(?:(?:or|and|also|including)\s+)?remote(?:\s+(?:too|only))?\b/g, " ");
  const locationMatch = q.match(/\b(?:in|near|around)\s+([^;]+)$/);
  const place = (opts.location ?? locationMatch?.[1])?.replace(/[,\s]+$/g, "").trim().toLowerCase();
  if (locationMatch) q = q.slice(0, locationMatch.index);
  q = q.replace(/[,;]+/g, " ").trim();
  const level: Level = new RegExp(ENTRY, "i").test(q) ? "entry" : new RegExp(SENIOR, "i").test(q) ? "senior" : "any";
  const internships = /\bintern(ship)?s?\b/.test(q);
  const role =
    q
      .replace(new RegExp(ENTRY, "gi"), " ")
      .replace(new RegExp(SENIOR, "gi"), " ")
      .replace(/\b(intern(ship)?s?|jobs?|roles?|positions?)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/(engineer|developer|analyst|scientist|technician|programmer)s$/, "$1");
  if (!role) throw new Error("Provide a job title, for example: junior software engineer in Chicago, last 7 days.");
  const canonical = ALIASES[role] ?? role;
  return validatePlan({
    titles: ROLE_TITLES[canonical] ?? [role],
    level,
    locations: place ? (opts.locationMode === "strict" ? [place] : METROS[place.replace(/,.*$/, "")] ?? [place]) : [],
    remote,
    posted: opts.posted,
    days: opts.days ?? (opts.posted ? undefined : impliedDays),
    count: opts.count ?? (countMatch ? Number(countMatch[1]) : 25),
    internships,
    locationMode: opts.locationMode ?? "expand",
  });
}

export const searchDays = (plan: SearchPlan): number | undefined => plan.days ?? (plan.posted ? POSTED_WINDOWS[plan.posted] : undefined);

export function validatePlan(plan: SearchPlan): SearchPlan {
  if (!plan.titles.length || plan.titles.length > 20 || plan.titles.some((t) => t.trim().length < 2)) throw new Error("Provide 1-20 job titles (at least two characters each).");
  if (!Number.isInteger(plan.count) || plan.count < 1 || plan.count > 200) throw new Error("count must be an integer from 1 to 200.");
  const days = searchDays(plan);
  if (days !== undefined && (!Number.isFinite(days) || days <= 0 || days > 365)) throw new Error("days must be greater than 0 and at most 365.");
  if (plan.posted && !Object.hasOwn(POSTED_WINDOWS, plan.posted)) throw new Error("Invalid posted window.");
  if (!["entry", "mid", "senior", "any"].includes(plan.level)) throw new Error("Invalid level.");
  if (plan.sources && !["recommended", "employers", "any"].includes(plan.sources)) throw new Error("sources must be recommended, employers, or any.");
  return plan;
}

/** Search engines return near matches; check the title itself before loading. */
export function titleFit(title: string, plan: SearchPlan): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, ""));
  const actual = new Set(words(title));
  return plan.titles.some((t) => words(t).every((w) => actual.has(w)));
}

const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|manager|director|head|architect|vp|distinguished|fellow|chief)\b/i;
const LEVEL_NUMBER = /\b(ii|iii|iv|v|vi|vii|viii|ix|[2-9]|[1-9]\d+)\b(?!\s*(\+|years))/i;
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

export const STATES: Record<string, string> = {
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
