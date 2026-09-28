import { describe, expect, it } from "vitest";
import { boardScore, workdayPosted } from "../src/boards";
import { planFromQuery } from "../src/intent";
import { postingText } from "../src/readers/page";

describe("which company boards a search pulls", () => {
  const chicago = planFromQuery("software engineer in Chicago");
  const board = (over: Partial<{ states: string[]; points: Array<[number, number]>; remote: boolean }>) => ({ states: [], points: [], remote: false, ...over });

  it("prefers boards that hire near you, then in your state, then remotely", () => {
    expect(boardScore(board({ points: [[42.05, -87.68]], states: ["IL"] }), chicago)).toBe(3); // Evanston
    expect(boardScore(board({ points: [[40.69, -89.59]], states: ["IL"] }), chicago)).toBe(2); // Peoria
    expect(boardScore(board({ points: [[30.27, -97.74]], states: ["TX"], remote: true }), chicago)).toBe(1);
    expect(boardScore(board({ points: [[30.27, -97.74]], states: ["TX"] }), chicago)).toBe(0);
  });

  it("stays within the radius when the search is strict, and takes a whole state for state searches", () => {
    const strict = planFromQuery("software engineer in Chicago", { locationMode: "strict" });
    expect(boardScore(board({ points: [[40.69, -89.59]], states: ["IL"], remote: true }), strict)).toBe(0);
    expect(boardScore(board({ states: ["TX"] }), planFromQuery("data analyst in Texas"))).toBe(3);
  });
});

describe("Workday's relative dates", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  it("turns 'Posted N Days Ago' into a date, and leaves '30+ days' undated", () => {
    expect(workdayPosted("Posted Today", now)).toBe("2026-09-28");
    expect(workdayPosted("Posted Yesterday", now)).toBe("2026-09-27");
    expect(workdayPosted("Posted 5 Days Ago", now)).toBe("2026-09-23");
    expect(workdayPosted("Posted 30+ Days Ago", now)).toBeUndefined();
  });
});

describe("postings on pages without structured data", () => {
  it("takes the posting's own sections and leaves the site's menus and footer out", () => {
    const html = `<html><head><title>Software Engineer | Acme Careers</title></head><body>
      <nav><a>Jobs</a><a>Teams</a></nav>
      <div>Home</div><div>Search jobs</div>
      <h1>Software Engineer</h1>
      <p>Acme builds logistics software used by thousands of warehouses across North America, and we are growing fast.</p>
      <h2>Responsibilities</h2><ul><li>Build and ship services in Go and Python that route millions of shipments a day</li>
      <li>Own features end to end, from design review to on-call, with a small team that values clear writing</li>
      <li>Improve the reliability and observability of the systems you and your teammates run</li></ul>
      <h2>Qualifications</h2><ul><li>Bachelor's degree in computer science or a related field</li><li>Experience with SQL databases</li>
      <li>Strong communication skills and a habit of writing things down for your teammates</li></ul>
      <p>Apply now</p><footer>Privacy policy · © 2026 Acme</footer></body></html>`;
    const page = postingText(html)!;
    expect(page.title).toBe("Software Engineer");
    expect(page.description.startsWith("Acme builds logistics software")).toBe(true);
    expect(page.description).toContain("- Experience with SQL databases");
    expect(page.description).not.toMatch(/Search jobs|Privacy|Apply now/);
  });

  it("returns nothing for pages that aren't postings", () => {
    expect(postingText("<html><body><h1>Careers</h1><p>Join us!</p></body></html>")).toBeNull();
  });
});
