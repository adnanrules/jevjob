// Skill dictionary: canonical name → the spellings we recognize.
// This is how "Postgres" and "PostgreSQL" become the same skill. It's also the biggest weakness
// of the rule baseline: anything not listed here is invisible to it.
// Order matters only for display: findSkills returns skills in this order.
const SKILLS: Record<string, string[]> = {
  java: ["java"],
  python: ["python"],
  "c++": ["c++", "cpp"],
  javascript: ["javascript"],
  typescript: ["typescript"],
  go: ["go", "golang"],
  rust: ["rust"],
  sql: ["sql"],
  git: ["git"],
  "spring boot": ["spring boot"],
  react: ["react", "react.js", "reactjs"],
  "next.js": ["next.js", "nextjs"],
  "node.js": ["node.js", "nodejs"],
  express: ["express", "express.js"],
  flask: ["flask"],
  "rest apis": ["rest api", "rest apis", "restful", "rest endpoints"],
  graphql: ["graphql"],
  grpc: ["grpc"],
  kafka: ["kafka"],
  postgresql: ["postgresql", "postgres"],
  mongodb: ["mongodb", "mongo"],
  aws: ["aws", "amazon web services"],
  docker: ["docker"],
  kubernetes: ["kubernetes", "k8s"],
  linux: ["linux"],
  "distributed systems": ["distributed systems", "distributed system"],
  pandas: ["pandas"],
  "scikit-learn": ["scikit-learn", "sklearn"],
  pytorch: ["pytorch"],
  tensorflow: ["tensorflow"],
  spark: ["spark", "pyspark"],
  mlflow: ["mlflow"],
  llm: ["llm", "llms", "large language model", "large language models"],
  hipaa: ["hipaa"],
  rtos: ["rtos", "vxworks", "real-time operating system", "real-time operating systems"],
  "do-178c": ["do-178c"],
};

/**
 * Hand-picked "close but not the same" pairs: having the value is partial evidence for the key.
 * Deliberately small. Docker → Kubernetes is NOT here: knowing one doesn't mean you can run the other.
 */
export const RELATED_SKILLS: Record<string, string[]> = {
  typescript: ["javascript"],
  "next.js": ["react"],
  pytorch: ["tensorflow"],
  tensorflow: ["pytorch"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Custom word boundaries, because \b breaks on "c++" and "next.js".
// Before: not a letter/digit/./+/#, so "js" can't match inside "node.js".
// After: not a letter/digit/+/#, so "java" can't match inside "javascript".
const PATTERNS = new Map(
  Object.entries(SKILLS).map(([canonical, aliases]) => [
    canonical,
    new RegExp(`(?<![a-z0-9.+#])(?:${aliases.map(escape).join("|")})(?![a-z0-9+#])`, "i"),
  ]),
);

/** Canonical names of every known skill mentioned in the text. */
export function findSkills(text: string): string[] {
  return [...PATTERNS].filter(([, re]) => re.test(text)).map(([canonical]) => canonical);
}

/** The first line of the text that mentions the skill, cleaned up for display as evidence. */
export function findSkillLine(text: string, skill: string): string | null {
  const re = PATTERNS.get(skill);
  const line = re && text.split("\n").find((l) => re.test(l));
  return line ? line.replace(/^[\s*•-]+/, "").replaceAll("**", "").trim() : null;
}
