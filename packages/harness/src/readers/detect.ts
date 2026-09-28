// Which applicant tracking system (ATS) a posting URL lives on, and the ids its API needs.
// Pure regexes, so every pattern is unit-tested against real URL shapes.

export type Ats =
  | "greenhouse" | "lever" | "ashby" | "workday" | "smartrecruiters" | "workable"
  | "oracle" | "icims" | "rippling" | "eightfold" | "amazon" | "ibm" | "apple";

export interface Target {
  ats: Ats;
  /** Named pieces of the URL each reader needs (board, id, host, …). */
  parts: Record<string, string>;
}

const PATTERNS: Array<[Ats, RegExp, string[]]> = [
  ["greenhouse", /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([\w-]+)\/jobs\/(\d+)/i, ["board", "id"]],
  ["lever", /jobs\.(eu\.)?lever\.co\/([\w.-]+)\/([0-9a-f]{8}-[0-9a-f-]{27})/i, ["eu", "board", "id"]],
  ["ashby", /jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f]{8}-[0-9a-f-]{27})/i, ["board", "id"]],
  // Workday has two domains: <tenant>.wdN.myworkdayjobs.com/<site>/job/… and wdN.myworkdaysite.com/recruiting/<tenant>/<site>/job/…
  ["workday", /([\w-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)(\/job\/[^?#]+?)(?:\/apply)?\/?(?:[?#]|$)/i, ["host", "site", "path"]],
  ["workday", /(wd\d+\.myworkdaysite\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\/([\w-]+)\/([\w-]+)(\/job\/[^?#]+?)(?:\/apply)?\/?(?:[?#]|$)/i, ["host", "tenant", "site", "path"]],
  ["smartrecruiters", /(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)\/(\d{6,})/i, ["board", "id"]],
  ["workable", /apply\.workable\.com\/([\w-]+)\/j\/([A-Za-z0-9]+)/i, ["board", "id"]],
  ["oracle", /([\w-]+\.fa(?:\.[\w-]+)?\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[\w-]+\/sites\/(\w+)\/job\/(\d+)/i, ["host", "site", "id"]],
  ["icims", /\b((?!www\.)[\w-]+\.icims\.com)\/jobs\/(\d+)/i, ["host", "id"]],
  ["rippling", /ats\.rippling\.com\/([\w-]+)\/jobs\/([0-9a-f]{8}-[0-9a-f-]{27})/i, ["board", "id"]],
  // Big employers with their own public search APIs.
  ["eightfold", /(apply\.careers\.microsoft\.com)\/careers\/job\/(\d+)/i, ["host", "id"]],
  ["amazon", /amazon\.jobs\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/(\d+)/i, ["id"]],
  ["ibm", /careers\.ibm\.com\/.*[?&]jobId=(\d+)/i, ["id"]],
  ["apple", /jobs\.apple\.com\/[\w-]+\/details\/(\d+)/i, ["id"]],
];

export function detect(url: string): Target | null {
  for (const [ats, pattern, names] of PATTERNS) {
    const m = url.match(pattern);
    if (!m) continue;
    const parts: Record<string, string> = {};
    names.forEach((name, i) => (parts[name] = m[i + 1] ?? ""));
    if (ats === "workday" && !parts.tenant) parts.tenant = parts.host!.split(".")[0]!;
    return { ats, parts };
  }
  return null;
}
