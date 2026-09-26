// The slice of the harness a web server needs: the job pool and assessor selection.
// Kept apart from index.ts so bundlers don't pull in process-spawning code (openApp, Joboid import).
export { currentJobs, poolVersion, type JobSource } from "./jobs";
export { ROOT } from "./paths";
export { getAssessor, jevAvailable, type Engine } from "./rank";
