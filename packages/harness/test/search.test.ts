import { describe, expect, it, vi } from "vitest";
import { collectPublicJobs, queryFor, type ExaDependencies } from "../src/exa";
import { searchAreas, areaFit } from "../src/geography";
import { planFromQuery } from "../src/intent";
import { canonicalUrl, parsePosting, plainText, type WebResult } from "../src/posting";
import { earlyTitleMismatch, entryExperienceIssue, sourceIssue } from "../src/search-quality";
import { publicAddress, publicUrl } from "../src/public-page";
import { requestPlan, searchRequestSchema } from "../src/search-request";

const now = Date.parse("2026-09-26T12:00:00Z");
const description = "Responsibilities: Build reliable software systems and support users.\nRequirements: Python and JavaScript skills, communication skills and familiarity with SQL.\nWork with the engineering team to build, test and deliver useful software products for our customers.";
const record = (extra: Record<string, unknown> = {}) => ({ "@type": "JobPosting", title: "Software Engineer", hiringOrganization: { name: "Example Employer" }, datePosted: "2026-09-25", description, jobLocation: { address: { addressLocality: "Chicago", addressRegion: "IL", addressCountry: "US" } }, ...extra });
const html = (extra: Record<string, unknown> = {}) => `<script type="application/ld+json">${JSON.stringify({ "@graph": [record(extra)] })}</script>`;
const plan = () => ({ ...planFromQuery("software engineer in Chicago, last 7 days", { count: 2 }), sources: "any" as const });
const deps = (results: WebResult[] = [{ url: "https://jobs.example.com/123" }], page = html()): ExaDependencies => ({ search: vi.fn(async () => results), page: vi.fn(async () => page), now: () => now });

describe("plain language and structured requests", () => {
  it("parses role, count, metro, days and remote without treating filters as title words", () => {
    expect(planFromQuery("find 20 junior software engineer jobs in Chicago or remote, last 14 days")).toMatchObject({ level: "entry", count: 20, days: 14, remote: true, locationMode: "expand" });
    expect(planFromQuery("find 20 junior software engineer jobs in Chicago or remote, last 14 days").titles).toContain("software engineer");
    expect(planFromQuery("pharmacy technician in Boston, last week")).toMatchObject({ titles: ["pharmacy technician"], locations: ["boston"], days: 7 });
  });
  it("honors explicit filters, including false/empty, without schema defaults erasing query intent", () => {
    const parsed = searchRequestSchema.parse({ query: "10 junior software engineer in Chicago or remote, last 14 days", count: 5, remote: false, locations: [], posted: "24h" });
    expect(requestPlan(parsed)).toMatchObject({ count: 5, remote: false, locations: [], level: "entry", posted: "24h", days: undefined });
    expect(requestPlan(searchRequestSchema.parse({ query: "junior software engineer in Chicago, last 7 days" }))).toMatchObject({ level: "entry", days: 7 });
    expect(() => requestPlan(searchRequestSchema.parse({}))).toThrow("query or titles");
  });
  it("rejects invalid counts/windows and does not silently pick a role", () => {
    expect(() => planFromQuery("software engineer", { count: NaN })).toThrow("count");
    expect(() => planFromQuery("software engineer", { days: 0 })).toThrow("days");
    expect(() => planFromQuery("find jobs in Chicago")).toThrow("job title");
  });
});

describe("geographic expansion", () => {
  it("widens Chicago in the requested order and allows strict searches", () => {
    expect(searchAreas(plan()).map((a) => a.label)).toEqual(["Chicago", "Chicago area", "Illinois", "States surrounding Illinois", "United States (remote only)"]);
    expect(searchAreas({ ...plan(), locationMode: "strict" })).toHaveLength(1);
    expect(requestPlan(searchRequestSchema.parse({ query: "software engineer in Chicago", location_mode: "strict" })).locations).toEqual(["chicago"]);
    expect(searchAreas(planFromQuery("engineer in Atlantis"))).toHaveLength(1);
  });
  it("accepts explicit US remote, excludes onsite and foreign/unknown remote eligibility", () => {
    const remote = searchAreas(plan()).at(-1)!;
    expect(areaFit("Remote - United States", remote)).toBe(true);
    expect(areaFit("Remote - Germany", remote)).toBe(false);
    expect(areaFit("San Francisco, CA, US", remote)).toBe(false);
    expect(areaFit("Remote", remote)).toBe(false);
    expect(areaFit("Hybrid / Remote - US", remote)).toBe(false);
    expect(queryFor(plan(), 0, remote)).toContain("remote work only");
    const single = { ...plan(), titles: ["software engineer"] };
    expect(queryFor(single, 1)).not.toBe(queryFor(single, 0));
  });
});

describe("public posting extraction", () => {
  it("decodes escaped HTML before stripping tags and preserves list structure for ranking", () => {
    expect(plainText("&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;7+ years of Java experience&lt;/li&gt;&lt;/ul&gt;")).toBe("Requirements\n- 7+ years of Java experience");
  });
  it("extracts JobPosting structured data and uses the source link", () => {
    const parsed = parsePosting({ url: "https://jobs.example.com/123?utm_source=search" }, html(), now);
    expect(parsed).toMatchObject({ method: "jobposting", job: { company: "Example Employer", title: "Software Engineer", location: "Chicago, IL, US", postedAt: "2026-09-25", applyUrl: "https://jobs.example.com/123" } });
  });
  it("rejects multiple jobs, closures and expired listings", () => {
    expect(parsePosting({ url: "https://jobs.example.com/123" }, `<script type='application/ld+json'>${JSON.stringify([record(), record()])}</script>`, now)).toMatchObject({ reason: "multiple jobs on one page" });
    expect(parsePosting({ url: "https://jobs.example.com/123", text: "No longer accepting applications" }, html(), now)).toMatchObject({ reason: "posting is closed" });
    expect(parsePosting({ url: "https://jobs.example.com/123" }, html({ validThrough: "2026-09-20" }), now)).toMatchObject({ reason: "posting is expired" });
  });
  it("accepts explicit metadata in full public text; never treats an index date as a posting date", () => {
    const parsed = parsePosting({ url: "https://board.example.com/123", title: "Software Engineer at Example Employer", text: `Software Engineer at Example Employer\nLocation: Chicago, IL\n${description}`, publishedDate: "2026-09-25" }, "", now);
    expect(parsed).toMatchObject({ method: "page-text", job: { location: "Chicago, IL" } });
    expect("job" in parsed && parsed.job.postedAt).toBeUndefined();
    expect(parsePosting({ url: "https://board.example.com/search", title: "100 jobs in Chicago", text: description }, "", now)).toHaveProperty("reason");
  });
  it("canonicalizes tracking without dropping job identifiers and rejects private URLs", () => {
    expect(canonicalUrl("https://board.example.com/view?utm_source=x&jk=abc#apply")).toBe("https://board.example.com/view?jk=abc");
    for (const value of ["http://localhost/x", "https://127.0.0.1/x", "https://10.0.0.1/x", "https://user:pass@example.com/x"]) expect(() => publicUrl(value)).toThrow();
    for (const value of ["127.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fd00::1"]) expect(publicAddress(value)).toBe(false);
  });
});

describe("Exa discovery", () => {
  it("avoids fetching clearly senior titles without rejecting an ambiguous index title", async () => {
    const d = deps([{ url: "https://jobs.example.com/123", title: "Senior Software Engineer at Example" }]);
    const r = await collectPublicJobs({ ...plan(), level: "entry" }, { maxQueries: 1 }, d);
    expect(d.page).not.toHaveBeenCalled();
    expect(r.performance?.prefiltered).toBe(1);
    expect(earlyTitleMismatch("Example Employer careers", { ...plan(), level: "entry" })).toBe(false);
  });
  it("searches the open web, applies real posting dates, and de-duplicates mirrors", async () => {
    const d = deps([{ url: "https://jobs.example.com/123" }, { url: "https://board.example.com/mirror" }]);
    const result = await collectPublicJobs(plan(), { maxQueries: 1 }, d);
    expect(result.jobs).toHaveLength(1);
    expect(result.skipped["already seen or mirrored listing"]).toBe(1);
    expect(d.search).toHaveBeenCalledWith(expect.objectContaining({ type: "auto", startPublishedDate: "2026-09-19T12:00:00.000Z" }));
    expect(vi.mocked(d.search).mock.calls[0]![0]).not.toHaveProperty("includeDomains");
    expect(result).toMatchObject({ limited: true, areasSearched: ["Chicago"], matchesByArea: { Chicago: 1 } });
  });
  it("rejects undated, old, future, senior and unrelated postings", async () => {
    for (const extra of [{ datePosted: undefined }, { datePosted: "2026-09-01" }, { datePosted: "2026-10-01" }, { title: "Senior Software Engineer" }, { title: "Accountant" }]) {
      const p = { ...planFromQuery("junior software engineer in Chicago, last 7 days"), sources: "any" as const };
      const result = await collectPublicJobs(p, { maxQueries: 1 }, deps(undefined, html(extra)));
      expect(result.jobs).toHaveLength(0);
    }
  });
  it("widens only when needed and reuses a page across geographic stages", async () => {
    const d = deps(undefined, html({ jobLocation: { address: { addressLocality: "Naperville", addressRegion: "IL", addressCountry: "US" } } }));
    const result = await collectPublicJobs({ ...plan(), count: 1 }, {}, d);
    expect(result.areasSearched).toEqual(["Chicago", "Chicago area"]);
    expect(result.matchesByArea).toEqual({ "Chicago area": 1 });
    expect(d.page).toHaveBeenCalledTimes(1);
  });
  it("never accepts nationwide onsite and continues with new query variants", async () => {
    const d = deps(undefined, html({ jobLocation: { address: { addressLocality: "Seattle", addressRegion: "WA", addressCountry: "US" } } }));
    const result = await collectPublicJobs(plan(), {}, d);
    expect(result.jobs).toHaveLength(0);
    expect(result.areasSearched).toHaveLength(5);
    const next = await collectPublicJobs(plan(), { round: result.nextRound, maxQueries: 1 }, d);
    expect(next.queries[0]).not.toBe(result.queries[0]);
  });
  it("fails explicitly on provider errors instead of silently using tracked companies", async () => {
    const d = deps(); d.search = async () => { throw new Error("Exa search HTTP 401"); };
    await expect(collectPublicJobs(plan(), {}, d)).rejects.toThrow("401");
  });
});

describe("quality regressions from the live search", () => {
  it("catches unbulleted, escaped HTML, and en-dash experience requirements", () => {
    expect(entryExperienceIssue("10 years of software development experience, including Spring Boot")).toBe(true);
    expect(entryExperienceIssue("Qualifications 3–6 years of experience in software development")).toBe(true);
    expect(entryExperienceIssue("&lt;p&gt;7+ years of experience building cloud applications&lt;/p&gt;")).toBe(true);
    expect(entryExperienceIssue("You have 5 years of programming experience.")).toBe(true);
  });
  it("does not mistake company history, preferred experience, or junior ranges for hard requirements", () => {
    expect(entryExperienceIssue("Our company has 100 years of experience in finance.")).toBe(false);
    expect(entryExperienceIssue("With over 100 years of experience and colleagues in over 30 countries, Fitch serves customers.")).toBe(false);
    expect(entryExperienceIssue("Preferred Qualifications\n5 years of Java experience\nRequirements\n0-2 years of experience")).toBe(false);
    expect(entryExperienceIssue("2-5 years proven experience preferred")).toBe(false);
    expect(entryExperienceIssue("0-2 years of programming experience")).toBe(false);
  });
  it("rejects obfuscated employer and training-lead listings regardless of domain", () => {
    const parsed = parsePosting({ url: "https://jobs.example.com/123" }, html(), now);
    if (!("job" in parsed)) throw new Error("Fixture must parse");
    expect(sourceIssue({ ...parsed.job, company: "board.example.com" })).toContain("employer");
    expect(sourceIssue({ ...parsed.job, description: "Reputed company is hiring" })).toContain("obscured");
    expect(sourceIssue({ ...parsed.job, description: "We helped jobseekers get employed through training" })).toContain("training");
    expect(sourceIssue(parsed.job)).toBeNull();
  });
});
