import { describe, expect, it } from "vitest";
import { levelFit, planFromQuery } from "../src/intent";

describe("planFromQuery (the CLI's fallback when no chat model writes the plan)", () => {
  it("splits a level from a role and expands the role into real job titles", () => {
    const plan = planFromQuery("junior software engineer");
    expect(plan.level).toBe("entry");
    expect(plan.titles).toEqual(expect.arrayContaining(["software developer", "full stack", "backend engineer"]));
  });

  it("treats aliases and plurals as the same role, and ignores filler words", () => {
    expect(planFromQuery("entry level developers").titles).toContain("software engineer");
    expect(planFromQuery("new grad ml engineer jobs").titles).toContain("machine learning engineer");
  });

  it("keeps an unknown role as a literal title phrase", () => {
    expect(planFromQuery("pharmacy technician")).toMatchObject({ level: "any", titles: ["pharmacy technician"] });
  });

  it("keeps the place as one point; distance decides what's near (geography.ts)", () => {
    expect(planFromQuery("software engineer", { location: "Chicago" }).locations).toEqual(["chicago"]);
  });
});

describe("levelFit", () => {
  const entry = { level: "entry" as const };
  it("excludes senior and II/III titles for entry-level searches, and prefers explicit entry wording", () => {
    expect(levelFit("Senior Software Engineer", entry)).toBeNull();
    expect(levelFit("Software Engineer II", entry)).toBeNull();
    expect(levelFit("Staff Engineer, Platform", entry)).toBeNull();
    expect(levelFit("Software Engineer I", entry)).toBe(2);
    expect(levelFit("Associate Software Developer", entry)).toBe(2);
    expect(levelFit("Software Engineer", entry)).toBe(1);
  });

  it("drops internships unless asked for", () => {
    expect(levelFit("Software Engineering Intern", entry)).toBeNull();
    expect(levelFit("Software Engineering Intern", { level: "entry", internships: true })).toBe(1);
  });
});

describe("places in a request", () => {
  it("keeps the place as typed and reads a radius", () => {
    expect(planFromQuery("junior software engineer in Raleigh, NC")).toMatchObject({ locations: ["raleigh, nc"] });
    const within = planFromQuery("junior software engineer within 20 miles of Chicago");
    expect(within).toMatchObject({ locations: ["chicago"], radiusMiles: 20 });
    expect(planFromQuery("data analyst in Austin within 30 miles")).toMatchObject({ locations: ["austin"], radiusMiles: 30 });
  });
});
