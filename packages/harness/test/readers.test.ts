import { afterEach, describe, expect, it, vi } from "vitest";
import { detect, fromJobPosting, jobPostings, readPostings } from "../src/readers";

describe("which system a posting URL lives on", () => {
  it.each([
    ["https://job-boards.greenhouse.io/imc/jobs/4823836101", "greenhouse", { board: "imc", id: "4823836101" }],
    ["https://jobs.lever.co/acme/1b2c3d4e-0000-4000-8000-123456789abc", "lever", { board: "acme", id: "1b2c3d4e-0000-4000-8000-123456789abc" }],
    ["https://jobs.ashbyhq.com/acme/1b2c3d4e-0000-4000-8000-123456789abc?utm=x", "ashby", { board: "acme" }],
    ["https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Santa-Clara/Engineer_JR1/apply", "workday",
      { host: "nvidia.wd5.myworkdayjobs.com", tenant: "nvidia", site: "NVIDIAExternalCareerSite", path: "/job/Santa-Clara/Engineer_JR1" }],
    ["https://wd5.myworkdaysite.com/recruiting/microchiphr/External/job/CA---Santa-Rosa/Engineer-I_R2844-26", "workday",
      { host: "wd5.myworkdaysite.com", tenant: "microchiphr", site: "External", path: "/job/CA---Santa-Rosa/Engineer-I_R2844-26" }],
    ["https://hdid.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/3734", "oracle", { host: "hdid.fa.us2.oraclecloud.com", site: "CX_1", id: "3734" }],
    ["https://careers-acme.icims.com/jobs/8107/job?mobile=true", "icims", { host: "careers-acme.icims.com", id: "8107" }],
    ["https://jobs.smartrecruiters.com/Acme/744000012345678-software-engineer", "smartrecruiters", { board: "Acme", id: "744000012345678" }],
    ["https://apply.workable.com/acme/j/5840ECEB50/apply", "workable", { board: "acme", id: "5840ECEB50" }],
    ["https://amazon.jobs/en/jobs/10408763/software-development-engineer-2026", "amazon", { id: "10408763" }],
    ["https://careers.ibm.com/careers/JobDetail?jobId=131212&source=WEB", "ibm", { id: "131212" }],
  ])("%s → %s", (url, ats, parts) => {
    const target = detect(url);
    expect(target?.ats).toBe(ats);
    expect(target?.parts).toMatchObject(parts);
  });

  it("leaves unknown sites to the page reader", () => {
    expect(detect("https://careers.example.com/jobs/123")).toBeNull();
    expect(detect("https://www.icims.com/jobs/1")).toBeNull();
  });
});

describe("schema.org JobPosting pages", () => {
  const page = `<html><script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":"JobPosting","title":"Software Engineer",
    "datePosted":"2026-09-20T00:00:00Z","description":"&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;",
    "jobLocation":{"address":{"addressLocality":"Chicago","addressRegion":"IL","addressCountry":{"name":"US"}}}}]}</script></html>`;

  it("finds postings nested in @graph and keeps list structure", () => {
    const [p] = jobPostings(page);
    const posting = fromJobPosting(p!, "https://careers.example.com/1")!;
    expect(posting).toMatchObject({ title: "Software Engineer", location: "Chicago, IL, US", postedAt: "2026-09-20" });
    expect(posting.description).toBe("- Python\n- SQL");
  });
});

describe("reading many postings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the ATS API, and one failure never sinks the batch", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/jobs/1")) {
        return new Response(JSON.stringify({ title: "Software Engineer", content: "&lt;p&gt;Build things&lt;/p&gt;", location: { name: "Chicago, IL" },
          first_published: "2026-09-20T12:00:00-04:00", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1" }));
      }
      return new Response("gone", { status: 404 });
    }));
    const results = await readPostings(["https://job-boards.greenhouse.io/acme/jobs/1", "https://job-boards.greenhouse.io/acme/jobs/2"]);
    expect(results[0]).toMatchObject({ ok: true, posting: { title: "Software Engineer", location: "Chicago, IL", postedAt: "2026-09-20", description: "Build things" } });
    expect(results[1]).toMatchObject({ ok: false, closed: true });
  });
});
