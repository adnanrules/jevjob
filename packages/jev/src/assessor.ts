// The Jev Assessor. Same interface as rulesAssessor, so the eval and UI can't tell them apart.
//   Stage 1 (only when needed): the rules found no requirements section, so Jev classifies every candidate
//            line of the posting. That answer depends only on the posting, so it's cached across resumes.
//   Stage 2 (always): one call judging every requirement against the resume, all questions in parallel.
import { TypeSafeClient, type Questions } from "@typesafe-ai/sdk";
import {
  assessJob, assessRequirement, candidateLines, requirementsFromLines, type AssessedJob, type Assessor, type RawJob,
} from "@jevjob/core";
import type { Cache } from "./cache";
import { interpret } from "./interpret";
import { buildLineRequest, pickRequirementLines } from "./lines";
import { buildRequest } from "./questions";

/** The two things we use from the SDK client. Tests pass a fake with this shape. */
export type JevClient = Pick<TypeSafeClient, "systemOne" | "defaultModel">;

export interface JevAssessorOptions {
  /** Defaults to a real client configured from TYPESAFE_* environment variables. */
  client?: JevClient;
  cache?: Cache;
}

/** Fewer required items than this means the rules probably missed the posting's requirements section. */
const MIN_RULE_REQUIREMENTS = 3;

interface CachedResponse {
  answers: unknown;
  inputTokens: number;
}

export function createJevAssessor({ client = new TypeSafeClient(), cache }: JevAssessorOptions = {}): Assessor {
  const ask = async (state: unknown, questions: Questions) => {
    const cacheKey = { model: client.defaultModel, state, questions };
    const hit = (await cache?.get(cacheKey)) as CachedResponse | undefined;
    if (hit) return { ...hit, cached: true };
    const result = await client.systemOne({ state: state as never, questions });
    const response: CachedResponse = { answers: result.answers, inputTokens: result.usage.input_tokens };
    await cache?.set(cacheKey, response);
    return { ...response, cached: false };
  };

  return {
    name: "jev",
    async assess(resume, job) {
      let base = assessJob(resume, job);
      let calls = 0;
      let inputTokens = 0;
      let allCached = true;

      if (base.requirements.filter((r) => r.importance === "required").length < MIN_RULE_REQUIREMENTS) {
        const found = await extractWithJev(job, ask);
        if (found) {
          calls++;
          inputTokens += found.inputTokens;
          allCached &&= found.cached;
          if (found.requirements.length) {
            base = { job, requirements: found.requirements, assessments: found.requirements.map((r) => assessRequirement(resume, r)) };
          }
        }
      }

      if (base.requirements.length === 0) return { assessed: base, calls, inputTokens, cached: allCached };

      const { state, questions, plan } = buildRequest(resume, job, base.requirements);
      const response = await ask(state, questions);
      return {
        assessed: interpret(base, plan, response.answers, resume),
        calls: calls + 1,
        inputTokens: inputTokens + response.inputTokens,
        cached: allCached && response.cached,
      };
    },
  };
}

async function extractWithJev(
  job: RawJob,
  ask: (state: unknown, questions: Questions) => Promise<CachedResponse & { cached: boolean }>,
): Promise<(CachedResponse & { cached: boolean; requirements: AssessedJob["requirements"] }) | null> {
  const lines = candidateLines(job.description);
  if (lines.length === 0) return null;
  const { state, questions } = buildLineRequest(job, lines);
  const response = await ask(state, questions);
  return { ...response, requirements: requirementsFromLines(pickRequirementLines(lines, response.answers), job.id) };
}
