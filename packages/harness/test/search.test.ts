import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { RawJob } from "@jevjob/core";
import { placement, searchAreas } from "../src/geography";
import { planFromQuery } from "../src/intent";
import { plainText } from "../src/posting";
import { entryExperienceIssue, sourceIssue } from "../src/search-quality";

// The search session writes files; keep them away from the real pool. No Joboid either: career sites are
// "unavailable", so a short search goes straight to widening its window.
process.env.JEVJOB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "jevjob-test-"));
process.env.JOBOID_DIR = process.env.JEVJOB_DATA_DIR;
let indeed: typeof import("../src/indeed");
let jobs: typeof import("../src/jobs");
beforeAll(async () => {
  indeed = await import("../src/indeed");
  jobs = await import("../src/jobs");
});

describe("plain-language requests", () => {
  it("parses role, count, metro, days and remote without treating filters as title words", () => {
    const plan = planFromQuery("find 20 junior software engineer jobs in Chicago or remote, last 14 days");
    expect(plan).toMatchObject({ level: "entry", count: 20, days: 14, remote: true, locationMode: "expand" });
    expect(plan.titles).toContain("software engineer");
    expect(planFromQuery("pharmacy technician in Boston, last week")).toMatchObject({ titles: ["pharmacy technician"], locations: ["boston"], days: 7 });
  });

  it("rejects invalid counts/windows and does not silently pick a role", () => {
    expect(() => planFromQuery("software engineer", { count: NaN })).toThrow("count");
    expect(() => planFromQuery("software engineer", { days: 0 })).toThrow("days");
    expect(() => planFromQuery("find jobs in Chicago")).toThrow("job title");
  });
});

describe("geography: widen from the city, but other states only if remote", () => {
  const chicago = planFromQuery("junior software engineer in Chicago");

  it("searches the city, nearby cities, the state, then remote, in that order", () => {
    const areas = searchAreas(chicago).map((a) => a.query);
    expect(areas[0]).toBe("Chicago, IL");
    expect(areas).toContain("Naperville, IL");
    expect(areas.indexOf("Illinois")).toBeGreaterThan(areas.indexOf("Naperville, IL"));
    expect(areas.at(-1)).toBe("remote");
  });

  it("accepts in-state onsite jobs, other states only when remote", () => {
    expect(placement("Peoria, IL", chicago)).toBe("home");
    expect(placement("Northbrook, IL", chicago)).toBe("home");
    expect(placement("Austin, TX", chicago)).toBe("no");
    expect(placement("Remote - United States", chicago)).toBe("remote");
    expect(placement("Hybrid remote in Austin, TX", chicago)).toBe("no");
    expect(placement("Remote - India", chicago)).toBe("no");
    expect(placement("Argentina Remote", chicago)).toBe("no");
    expect(placement("Remote - EMEA", chicago)).toBe("no");
  });

  it("stays put when asked to", () => {
    const strict = planFromQuery("software engineer in Chicago", { locationMode: "strict" });
    expect(searchAreas(strict).map((a) => a.query)).toEqual(["Chicago, IL"]);
    expect(placement("Remote - United States", strict)).toBe("no");
  });
});

describe("quality checks from live searches", () => {
  const job: RawJob = { id: "x", title: "Software Engineer", company: "Example Employer", location: "Chicago, IL", applyUrl: "https://example.com/1", description: "Requirements\n- Python\n- SQL\n- A bachelor's degree in computer science or related field" };

  it("catches unbulleted, escaped HTML, and en-dash experience requirements", () => {
    expect(entryExperienceIssue("10 years of software development experience, including Spring Boot")).toBe(true);
    expect(entryExperienceIssue("Qualifications 3–6 years of experience in software development")).toBe(true);
    expect(entryExperienceIssue("&lt;p&gt;7+ years of experience building cloud applications&lt;/p&gt;")).toBe(true);
    expect(entryExperienceIssue("You have 5 years of programming experience.")).toBe(true);
  });

  it("ends a preferred section at the next header (a live Capgemini posting slipped through)", () => {
    const posting = [
      "Required Skills & Experience", "Strong expertise in Java 17/21 and Spring Boot.",
      "Preferred Qualifications", "AWS Architect Certification", "Strong analytical and problem-solving skills",
      "Soft Skills", "Strong communication and collaboration abilities",
      "Experience Level", "8 to 12+ years of Java development experience.",
    ].join("\n");
    expect(entryExperienceIssue(posting)).toBe(true);
    // A preferred bullet that merely starts with "Experience" is not a header.
    expect(entryExperienceIssue("Nice to have\nExperience with Kafka\n5+ years of Scala experience")).toBe(false);
  });

  it("does not mistake company history, preferred experience, or junior ranges for hard requirements", () => {
    expect(entryExperienceIssue("Our company has 100 years of experience in finance.")).toBe(false);
    expect(entryExperienceIssue("Preferred Qualifications\n5 years of Java experience\nRequirements\n0-2 years of experience")).toBe(false);
    expect(entryExperienceIssue("2-5 years proven experience preferred")).toBe(false);
    expect(entryExperienceIssue("0-2 years of programming experience")).toBe(false);
  });

  it("rejects obfuscated employers and training-lead listings", () => {
    expect(sourceIssue({ ...job, company: "board.example.com" })).toContain("employer");
    expect(sourceIssue({ ...job, description: "Reputed company is hiring" })).toContain("obscured");
    expect(sourceIssue({ ...job, description: "We helped jobseekers get employed through training" })).toContain("training");
    expect(sourceIssue(job)).toBeNull();
  });

  it("decodes escaped HTML and keeps list structure", () => {
    expect(plainText("&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;7+ years of Java experience&lt;/li&gt;&lt;/ul&gt;")).toBe("Requirements\n- 7+ years of Java experience");
  });
});

// Shaped exactly like the Indeed plugin's output.
/** A date the way the plugin writes it, n days ago. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric", timeZone: "UTC" });

const listing = (id: number, title: string, company: string, location: string, posted = "September 20, 2026") => `**Job Title:** ${title}
            **Job Id:** JOBSEARCH_${id}
            **Company:** ${company}
            **Location:** ${location}
            **Posted on:** ${posted}
            **Job Type:** Full-time
            **Compensation:** $90,000 - $120,000 a year
            **View Job URL:** https://to.indeed.com/aa${id}
            `;
const details = (id: number, title: string, company: string, location: string, body: string, posted = "September 20, 2026") => `### ${title}
        **View Job URL:** https://to.indeed.com/bb${id}
        **Job Id:** JOBSEARCH_${id}
        **Company:** ${company}
        **Location:** ${location}
        **Posted on:** ${posted}
        **Job Type:** Full-time
        **Compensation:** $90,000 - $120,000 a year

        ${body}`;

describe("the Indeed flow", () => {
  it("parses search results and job details, including the {result} wrapper", () => {
    const raw = JSON.stringify({ result: listing(1, "Software Engineer", "Caterpillar", "Chicago, IL") + "\n\n" + listing(2, "UX Engineer", "AAOS", "Rosemont, IL") });
    const parsed = indeed.parseSearchResults(raw);
    expect(parsed.map((l) => l.title)).toEqual(["Software Engineer", "UX Engineer"]);
    expect(parsed[0]).toMatchObject({ indeedId: "JOBSEARCH_1", company: "Caterpillar", postedAt: "2026-09-20", pay: "$90,000 - $120,000 a year" });
    const d = indeed.parseJobDetails(details(3, "Software Engineer", "Caterpillar", "Chicago, IL", "What You Will Have\n\nPython and SQL\n\nA bachelor's degree"));
    expect(d).toMatchObject({ title: "Software Engineer", company: "Caterpillar" });
    expect(d!.description).toContain("What You Will Have");
  });

  it("plans, filters listings before fetching, and loads in-state postings first", () => {
    const brief = indeed.startSearch(planFromQuery("junior software engineer in Chicago"));
    expect(brief.areas[0]!.query).toBe("Chicago, IL");
    expect(brief.next).toContain("search_jobs");

    const results = indeed.addSearchResults(
      [
        listing(10, "Software Engineer", "Caterpillar", "Chicago, IL"),
        listing(11, "Senior Software Engineer", "Big Co", "Chicago, IL"),
        listing(12, "UX Designer", "AAOS", "Rosemont, IL"),
        listing(13, "Software Engineer", "Far Away Inc", "Austin, TX"),
        listing(14, "Software Developer", "Remote Co", "Remote"),
        listing(10, "Software Engineer", "Caterpillar", "Chicago, IL"),
      ].join("\n\n"),
    );
    expect(results.fetch).toEqual(["JOBSEARCH_10", "JOBSEARCH_14"]); // in-state first, duplicate dropped
    expect(results.skipped).toMatchObject({ "wrong level": 1, "different role": 1, "outside the area (and not remote)": 1 });

    const body = "Qualifications\n\nPython\n\nSQL\n\nA bachelor's degree in computer science\n\n0-2 years of experience";
    const loaded = indeed.addJobs({
      indeedDetails: [
        details(14, "Software Developer", "Remote Co", "Remote", body),
        details(10, "Software Engineer", "Caterpillar", "Chicago, IL", body),
      ],
    });
    expect(loaded.addedNow).toBe(2);
    const pool = jobs.currentJobs();
    expect(pool.source).toBe("harness");
    expect(pool.jobs[0]!.company).toBe("Caterpillar"); // in-state before remote
    expect(pool.jobs[0]!.description).toContain("- Python"); // the posting's structure was rebuilt
    expect(pool.jobs[0]!.pay).toBe("$90,000 - $120,000 a year");
  });

  it("drops postings that need 3+ years for an entry-level search", () => {
    const summary = indeed.addJobs({ indeedDetails: [details(20, "Software Engineer", "Senior Shop", "Chicago, IL", "Requirements\n\n5+ years of professional software development experience")] });
    expect(summary.addedNow).toBe(0);
    expect(summary.skipped["requires 3+ years of experience"]).toBe(1);
  });

  it("'more' raises the target by one batch and continues the same search", () => {
    const before = indeed.searchStatus()!;
    const after = indeed.moreFromSearch();
    expect(after.target).toBe(before.loaded + indeed.BATCH_SIZE);
    expect(after.titles).toEqual(before.titles);
  });

  it("accepts postings from the model's own web search when Indeed isn't available", () => {
    indeed.startSearch(planFromQuery("software engineer in Chicago"));
    const summary = indeed.addJobs({
      postings: [{ title: "Software Engineer", company: "Acme", location: "Chicago, IL", url: "https://acme.example/careers/1?utm_source=x", description: "Requirements\n\nPython\n\nSQL\n\nComputer science degree or related field" }],
    });
    expect(summary.addedNow).toBe(1);
    expect(jobs.currentJobs().jobs[0]!.applyUrl).toBe("https://acme.example/careers/1");
  });
});

describe("when the search runs short", () => {
  const body = "Qualifications\n\nPython\n\nSQL\n\nA bachelor's degree in computer science\n\n0-2 years of experience";
  const chicagoOnly = () => indeed.startSearch(planFromQuery("junior software engineer in Chicago, last 7 days", { locationMode: "strict" }));

  it("widens only in steps, never past 4x the request (and at least to 30 days)", () => {
    expect(indeed.widenSteps(7)).toEqual([14, 30]);
    expect(indeed.widenSteps(1)).toEqual([3, 7, 14, 30]);
    expect(indeed.widenSteps(30)).toEqual([60, 90]);
  });

  it("skips an area once Indeed only repeats itself there", () => {
    const brief = chicagoOnly();
    const [q1, q2, q3] = brief.titles;
    const same = [listing(40, "Software Engineer", "Repeat Co", "Chicago, IL", daysAgo(2)), listing(41, "Web Developer", "Other Co", "Chicago, IL", daysAgo(3))].join("\n\n");
    expect(indeed.addSearchResults(same, { title: q1!, location: "Chicago, IL" }).saturated).toEqual([]);
    indeed.addSearchResults(same, { title: q2!, location: "Chicago, IL" }); // nothing new: dry once
    const third = indeed.addSearchResults(same, { title: q3!, location: "Chicago, IL" }); // dry twice: skip the area
    expect(third.saturated).toEqual(["chicago, il"]);
    expect(third.next).not.toContain("search_jobs");
  });

  it("counts a search full of new but irrelevant postings as dry", () => {
    const brief = chicagoOnly();
    const noise = (n: number) => [listing(n, "Staff Software Engineer - AI Trainer", `Gig Co ${n}`, "Chicago, IL", daysAgo(90)), listing(n + 1, "Senior Software Engineer", `Big Co ${n}`, "Chicago, IL", daysAgo(3))].join("\n\n");
    indeed.addSearchResults(noise(70), { title: brief.titles[0]!, location: "Chicago, IL" });
    const second = indeed.addSearchResults(noise(80), { title: brief.titles[1]!, location: "Chicago, IL" });
    expect(second.new).toBe(2);
    expect(second.saturated).toEqual(["chicago, il"]);
  });

  it("holds near misses back, then widens the window and tags them", () => {
    const brief = chicagoOnly();
    const results = indeed.addSearchResults(
      [
        listing(50, "Software Engineer", "Fresh Co", "Chicago, IL", daysAgo(2)),
        listing(51, "Software Engineer", "Nearly Co", "Evanston, IL", daysAgo(10)),
        listing(52, "Software Engineer", "Ancient Co", "Chicago, IL", daysAgo(60)),
      ].join("\n\n"),
      { title: brief.titles[0]!, location: "Chicago, IL" },
    );
    expect(results.fetch).toEqual(["JOBSEARCH_50"]);
    expect(results.nearMisses).toBe(1);
    expect(results.widenedTo).toBeNull();
    expect(results.skipped["too old"]).toBe(1);

    // The remaining searches find nothing new, so Chicago saturates and the 10-day-old posting is released.
    let last = results;
    for (const title of brief.titles.slice(1)) {
      if (!last.next.includes("search_jobs")) break;
      last = indeed.addSearchResults(listing(50, "Software Engineer", "Fresh Co", "Chicago, IL", daysAgo(2)), { title, location: "Chicago, IL" });
    }
    expect(last.widenedTo).toBe(14);
    expect(last.fetch).toEqual(["JOBSEARCH_50", "JOBSEARCH_51"]); // in-window first

    const loaded = indeed.addJobs({
      indeedDetails: [
        details(50, "Software Engineer", "Fresh Co", "Chicago, IL", body, daysAgo(2)),
        details(51, "Software Engineer", "Nearly Co", "Evanston, IL", body, daysAgo(10)),
      ],
    });
    expect(loaded.addedNow).toBe(2);
    const pool = jobs.currentJobs().jobs;
    expect(pool.find((j) => j.company === "Fresh Co")!.outsideWindowDays).toBeUndefined();
    expect(pool.find((j) => j.company === "Nearly Co")!.outsideWindowDays).toBe(7);
    expect(loaded.next).toContain("used up");
  });

  it("fills in the company when job details say None", () => {
    const brief = indeed.startSearch(planFromQuery("software engineer in Chicago"));
    indeed.addSearchResults(listing(60, "Software Engineer", "Named Co", "Chicago, IL"), { title: brief.titles[0]!, location: "Chicago, IL" });
    const loaded = indeed.addJobs({ indeedDetails: [details(60, "Software Engineer", "None", "Chicago, IL", body)] });
    expect(loaded.addedNow).toBe(1);
    expect(jobs.currentJobs().jobs[0]!.company).toBe("Named Co");
  });
});
