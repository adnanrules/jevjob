import { describe, expect, it } from "vitest";
import { levelFit, locationFit, planFromQuery } from "../src/intent";

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

  it("expands a metro into its suburbs", () => {
    expect(planFromQuery("software engineer", { location: "Chicago" }).locations).toEqual(expect.arrayContaining(["evanston", "schaumburg"]));
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

describe("locationFit", () => {
  const chicago = { locations: ["Chicago", "Northbrook", "Evanston"], remote: false };
  it("matches any listed city, and treats placeholders as unknown rather than a match", () => {
    expect(locationFit("Northbrook, IL", chicago)).toBe("match");
    expect(locationFit("Austin, Texas", chicago)).toBe("no");
    expect(locationFit("3 Locations", chicago)).toBe("unknown");
    expect(locationFit("", chicago)).toBe("unknown");
  });

  it("accepts remote postings only when remote was asked for", () => {
    expect(locationFit("Remote - United States", { locations: [], remote: true })).toBe("match");
    expect(locationFit("Remote - United States", chicago)).toBe("no");
  });

  it("understands a state name as its abbreviation", () => {
    expect(locationFit("Springfield, IL", { locations: ["Illinois"], remote: false })).toBe("match");
  });
});
