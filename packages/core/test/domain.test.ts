import { describe, expect, it } from "vitest";
import { lakeshoreRequirements } from "./helpers";

describe("domain model", () => {
  it("encodes every Lakeshore requirement line", () => {
    expect(lakeshoreRequirements).toHaveLength(8);
    expect(lakeshoreRequirements.filter((r) => r.importance === "required")).toHaveLength(5);
  });

  it("represents 'Java or Python' as ONE requirement with two options", () => {
    const javaOrPython = lakeshoreRequirements.find((r) => r.id.endsWith("#r2"));
    expect(javaOrPython?.kind === "skill" && javaOrPython.anyOf).toEqual(["java", "python"]);
  });
});
