// One reader per ATS: a posting URL's parts (from detect.ts) → the full posting, straight from the employer's system.
// These are the public APIs the career sites themselves call; no keys, no scraping of rendered pages.
import type { Ats } from "./detect";
import { get, isoDay, post, text } from "./http";
import { readPage } from "./page";
import type { Posting } from "./types";

type Reader = (parts: Record<string, string>, url: string) => Promise<Posting | null>;
// API JSON is untrusted and loosely shaped, so it is read defensively (optional chaining, defaults) rather than typed.
type Json = Record<string, any>;

const join = (...xs: Array<string | undefined | null>) => xs.filter(Boolean).join("; ");
const sections = (pairs: Array<[string, string | undefined | null]>) =>
  pairs.filter(([, body]) => body).map(([head, body]) => `${head}\n${text(body)}`.trim()).join("\n\n");

export const READERS: Record<Ats, Reader> = {
  async greenhouse({ board, id }, url) {
    const j = await get<Json>(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`);
    const at = j.absolute_url ?? url;
    return { title: j.title ?? "", location: j.location?.name ?? "", postedAt: isoDay(j.first_published ?? j.updated_at), postingUrl: at, applyUrl: at, description: text(j.content) };
  },

  async lever({ eu, board, id }, url) {
    const j = await get<Json>(`https://api.${eu ? "eu." : ""}lever.co/v0/postings/${board}/${id}`);
    const lists = (j.lists ?? []).map((l: Json) => `${l.text ?? ""}\n${text(l.content)}`);
    return {
      title: j.text ?? "",
      location: j.categories?.location ?? (j.categories?.allLocations ?? []).join("; "),
      postedAt: isoDay(j.createdAt),
      postingUrl: j.hostedUrl ?? url,
      applyUrl: j.applyUrl ?? j.hostedUrl ?? url,
      description: [j.descriptionPlain ?? text(j.description), ...lists, j.additionalPlain ?? ""].filter(Boolean).join("\n\n"),
    };
  },

  // Ashby has no single-posting endpoint; the board request is one call that already includes every description.
  async ashby({ board, id }, url) {
    const data = await get<Json>(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
    const j = (data.jobs ?? []).find((x: Json) => x.id === id);
    if (!j) return null;
    return {
      title: j.title ?? "",
      location: join(j.location, ...(j.secondaryLocations ?? []).map((s: Json) => s.location)),
      postedAt: isoDay(j.publishedAt),
      postingUrl: j.jobUrl ?? url,
      applyUrl: j.applyUrl ?? j.jobUrl ?? url,
      description: j.descriptionPlain ?? text(j.descriptionHtml),
    };
  },

  async workday({ host, tenant, site, path }) {
    const info = (await get<Json>(`https://${host}/wday/cxs/${tenant}/${site}${path}`)).jobPostingInfo ?? {};
    const root = host!.endsWith("myworkdaysite.com") ? `https://${host}/recruiting/${tenant}/${site}` : `https://${host}/${site}`;
    return {
      title: info.title ?? "",
      location: join(info.location, ...(info.additionalLocations ?? [])),
      postedAt: isoDay(info.startDate),
      postingUrl: info.externalUrl ?? `${root}${path}`,
      applyUrl: `${root}${path}/apply`,
      description: text(info.jobDescription),
    };
  },

  async smartrecruiters({ board, id }, url) {
    const d = await get<Json>(`https://api.smartrecruiters.com/v1/companies/${board}/postings/${id}`);
    const s = d.jobAd?.sections ?? {};
    return {
      title: d.name ?? "",
      location: d.location?.fullLocation ?? "",
      postedAt: isoDay(d.releasedDate),
      postingUrl: d.postingUrl ?? url,
      applyUrl: d.applyUrl ?? url,
      description: sections([["", s.companyDescription?.text], [s.jobDescription?.title ?? "", s.jobDescription?.text],
        [s.qualifications?.title ?? "Qualifications", s.qualifications?.text], ["", s.additionalInformation?.text]]),
    };
  },

  async workable({ board, id }) {
    const d = await get<Json>(`https://apply.workable.com/api/v2/accounts/${board}/jobs/${id}`);
    const page = `https://apply.workable.com/${board}/j/${id}/`;
    const loc = d.location ?? {};
    return {
      title: d.title ?? "",
      location: [loc.city, loc.region, loc.country].filter(Boolean).join(", ") + (d.remote || d.workplace === "remote" ? " (Remote)" : ""),
      postedAt: isoDay(d.published),
      postingUrl: page,
      applyUrl: `${page}apply/`,
      description: sections([["", d.description], ["Requirements", d.requirements], ["Benefits", d.benefits]]),
    };
  },

  async oracle({ host, site, id }, url) {
    const finder = encodeURIComponent(`ById;Id="${id}",siteNumber=${site}`);
    const d = ((await get<Json>(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${finder}`)).items ?? [])[0];
    if (!d) return null;
    return {
      title: d.Title ?? "",
      location: d.PrimaryLocation ?? "",
      postedAt: isoDay(d.ExternalPostedStartDate),
      postingUrl: url,
      applyUrl: url,
      description: sections([["", d.ExternalDescriptionStr], ["", d.ExternalResponsibilitiesStr], ["", d.ExternalQualificationsStr]]),
    };
  },

  // iCIMS pages embed a schema.org JobPosting; the in_iframe view is the plain one.
  async icims({ host, id }) {
    const page = `https://${host}/jobs/${id}/job`;
    const p = await readPage(`${page}?in_iframe=1`);
    return p && { ...p, postingUrl: page, applyUrl: page };
  },

  async rippling({ board, id }, url) {
    const d = await get<Json>(`https://ats.rippling.com/api/v2/board/${board}/jobs/${id}`);
    const parts = typeof d.description === "object" && d.description ? Object.values(d.description) : [d.description];
    return {
      title: d.name ?? "",
      location: (d.workLocations ?? []).map((l: unknown) => (typeof l === "string" ? l : (l as Json)?.name)).filter(Boolean).join("; "),
      postedAt: isoDay(d.createdOn),
      postingUrl: url,
      applyUrl: url,
      description: parts.filter((x): x is string => typeof x === "string").map(text).filter(Boolean).join("\n\n"),
    };
  },

  async eightfold({ host, id }, url) {
    const d = (await get<Json>(`https://${host}/api/pcsx/position_details?position_id=${id}&domain=microsoft.com&hl=en`)).data ?? {};
    return {
      title: d.name ?? "",
      location: (d.standardizedLocations ?? []).filter((l: string) => l && l !== "US").join("; ") || "United States",
      postedAt: isoDay(d.postedTs),
      postingUrl: d.publicUrl ?? url,
      applyUrl: d.publicUrl ?? url,
      description: text(d.jobDescription),
    };
  },

  async amazon({ id }) {
    const data = await get<Json>(`https://www.amazon.jobs/en/search.json?base_query=${id}&result_limit=10`);
    const j = (data.jobs ?? []).find((x: Json) => String(x.id_icims) === id);
    if (!j) return null;
    const page = `https://www.amazon.jobs${j.job_path}`;
    return {
      title: j.title ?? "",
      location: j.normalized_location ?? j.location ?? "",
      postedAt: isoDay(j.posted_date),
      postingUrl: page,
      applyUrl: j.url_next_step ?? page,
      description: sections([["", j.description], ["Basic qualifications", j.basic_qualifications], ["Preferred qualifications", j.preferred_qualifications]]),
    };
  },

  async apple({ id }, url) {
    const d = (await get<Json>(`https://jobs.apple.com/api/v1/jobDetails/${id}`)).res;
    if (!d) return null;
    const places = (d.locations ?? []).map((l: Json) => [l.city, l.stateProvince, l.countryName].filter(Boolean).join(", "));
    return {
      title: d.postingTitle ?? "",
      location: places.join("; ") + (d.homeOffice === true ? " (Remote)" : ""),
      postedAt: isoDay(d.postDateInGMT),
      postingUrl: url,
      applyUrl: url,
      description: sections([["", d.jobSummary], ["Description", d.description], ["Minimum Qualifications", d.minimumQualifications],
        ["Preferred Qualifications", d.preferredQualifications]]),
    };
  },

  // careers.ibm.com posting pages sit behind a bot check, but the site's search index holds the full text.
  async ibm({ id }, url) {
    const res = await post<Json>("https://www-api.ibm.com/search/api/v2", {
      appId: "careers", scopes: ["careers2"], lang: "zz", size: 1,
      query: { bool: { must: [{ match: { url: id } }] } },
      _source: ["title", "body", "dcdate", "field_keyword_17", "field_keyword_19"],
    });
    const s = res.hits?.hits?.[0]?._source;
    if (!s) return null;
    const place = String(s.field_keyword_19 ?? "").replace(/,\s*US$/, ", United States");
    return {
      title: s.title ?? "",
      location: s.field_keyword_17 === "Remote" ? `${place} (Remote)` : place,
      postedAt: isoDay(s.dcdate),
      postingUrl: url,
      applyUrl: url,
      description: String(s.body ?? ""),
    };
  },
};
