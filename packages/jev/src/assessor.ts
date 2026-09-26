// The Jev Assessor: rules extract the requirements (Jev doesn't generate text), then one Jev call per job
// judges them all in parallel. Same interface as rulesAssessor, so the eval and UI can't tell them apart.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { assessJob, type Assessor } from "@jevjob/core";
import type { Cache } from "./cache";
import { interpret } from "./interpret";
import { buildRequest } from "./questions";

/** The two things we use from the SDK client. Tests pass a fake with this shape. */
export type JevClient = Pick<TypeSafeClient, "systemOne" | "defaultModel">;

export interface JevAssessorOptions {
  /** Defaults to a real client configured from TYPESAFE_* environment variables. */
  client?: JevClient;
  cache?: Cache;
}

interface CachedResponse {
  answers: unknown;
  inputTokens: number;
}

export function createJevAssessor({ client = new TypeSafeClient(), cache }: JevAssessorOptions = {}): Assessor {
  return {
    name: "jev",
    async assess(resume, job) {
      const base = assessJob(resume, job);
      const { state, questions, plan } = buildRequest(resume, job, base.requirements);
      const cacheKey = { model: client.defaultModel, state, questions };

      let response = (await cache?.get(cacheKey)) as CachedResponse | undefined;
      const cached = response !== undefined;
      if (!response) {
        const result = await client.systemOne({ state, questions });
        response = { answers: result.answers, inputTokens: result.usage.input_tokens };
        await cache?.set(cacheKey, response);
      }

      return { assessed: interpret(base, plan, response.answers), calls: 1, inputTokens: response.inputTokens, cached };
    },
  };
}
