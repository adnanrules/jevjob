import { z } from "zod";
import { planFromQuery, validatePlan, type SearchPlan } from "./intent";

/** Shared MCP validation. Omitted fields never overwrite filters inferred from query. */
export const searchInput = {
  query: z.string().min(2).optional().describe("Plain request, e.g. 25 junior software engineer jobs in Chicago, last 7 days"),
  titles: z.array(z.string().min(2)).min(1).max(20).optional().describe("Structured alternative to query: job titles employers use"),
  level: z.enum(["entry", "mid", "senior", "any"]).optional(),
  locations: z.array(z.string().min(1)).max(60).optional().describe("Cities/states; Chicago widens to metro, Illinois, neighboring states, then US remote"),
  remote: z.boolean().optional(),
  posted: z.enum(["24h", "7d", "30d", "3month"]).optional(),
  days: z.number().positive().max(365).optional().describe("Rolling posting-age limit; overrides posted"),
  count: z.number().int().min(1).max(200).optional(),
  internships: z.boolean().optional(),
  location_mode: z.enum(["expand", "strict"]).optional().describe("expand (default): progressively widen supported US cities; strict: requested geography only"),
  provider: z.enum(["exa", "joboid"]).default("exa").describe("exa searches public listings; joboid explicitly searches tracked companies"),
  sources: z.enum(["recommended", "employers", "any"]).default("recommended").describe("recommended: discover employers through ATS boards plus Indeed/LinkedIn and established boards; employers: ATS only; any: unrestricted public web"),
  keep: z.boolean().default(false),
  max_queries: z.number().int().min(1).max(6).default(5).describe("Exa request budget. Five covers Chicago's five geographic stages if needed"),
};
export const searchRequestSchema = z.object(searchInput);
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export function requestPlan(input: SearchRequest): SearchPlan {
  if (!input.query && !input.titles) throw new Error("Provide query or titles.");
  const base = input.query ? planFromQuery(input.query, { locationMode: input.location_mode }) : { titles: input.titles!, level: "any" as const, locations: [], remote: false, count: 25 };
  return validatePlan({
    ...base,
    ...(input.titles !== undefined ? { titles: input.titles } : {}),
    ...(input.level !== undefined ? { level: input.level } : {}),
    ...(input.locations !== undefined ? { locations: input.locations } : {}),
    ...(input.remote !== undefined ? { remote: input.remote } : {}),
    ...(input.count !== undefined ? { count: input.count } : {}),
    ...(input.internships !== undefined ? { internships: input.internships } : {}),
    ...(input.posted !== undefined ? { posted: input.posted, days: undefined } : {}),
    ...(input.days !== undefined ? { days: input.days } : {}),
    locationMode: input.location_mode ?? "expand",
    sources: input.sources,
  });
}
