// npm run build:places: regenerates packages/harness/data/us-places.tsv.gz, the table geography.ts measures distances
// with. Source: the US Census Bureau (public domain):
//   - 2024 Gazetteer, places: every city, town, village and census-designated place, with coordinates
//   - 2024 Gazetteer, county subdivisions, for the states where towns and townships are the real municipalities
//     (New England, NJ, NY, PA and the upper Midwest: Edison, NJ or Needham, MA aren't "places")
//   - 2023 population estimates for incorporated places and those towns (CDPs have none; they get 0)
// Output rows: name, state, lat, lon, population, kind (P: city/town/CDP, S: township). Tab-separated, gzipped.
// Run it again when the Census updates.
import { gzipSync, inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GAZETTEER = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip";
const COUSUBS = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cousubs_national.zip";
const TOWNSHIP_STATES = new Set(["CT", "MA", "ME", "NH", "NJ", "NY", "PA", "RI", "VT", "MI", "MN", "WI"]);
const POPULATION = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/cities/totals/sub-est2023.csv";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packages/harness/data/us-places.tsv.gz");

const download = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

/** The first file in a zip archive (the Gazetteer zip holds one text file). */
function unzipFirst(zip: Buffer): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const central = zip.readUInt32LE(eocd + 16);
  const method = zip.readUInt16LE(central + 10);
  const size = zip.readUInt32LE(central + 20);
  const local = zip.readUInt32LE(central + 42);
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + size);
  return method === 8 ? inflateRawSync(data) : data;
}

/** "Chicago city" → "Chicago"; "Nashville-Davidson metropolitan government (balance)" → "Nashville-Davidson" + "Nashville". */
function names(raw: string): string[] {
  // One legal-type suffix, exactly once: "Jersey City city" → "Jersey City", not "Jersey".
  const name = raw.replace(/\s*\(balance\)$/i, "")
    .replace(/\s+(city and borough|consolidated government|unified government|metropolitan government|metro government|urban county|municipality|borough|city|town|township|village|plantation|CDP|comunidad|zona urbana)$/, "");
  const out = new Set([name]);
  const paren = name.match(/^(.+?)\s*\((.+)\)$/); // "San Buenaventura (Ventura)"
  if (paren) [paren[1]!, paren[2]!].forEach((n) => out.add(n));
  const split = name.match(/^([^/-]+)[/-](.+)$/); // "Louisville/Jefferson County", "Lexington-Fayette"
  if (split && /county|davidson|fayette|clarke|richmond|bibb/i.test(split[2]!)) out.add(split[1]!.trim());
  if (/^Urban /.test(name)) out.add(name.replace(/^Urban /, "")); // "Urban Honolulu"
  return [...out];
}

const population = new Map<string, number>();
const csv = (await download(POPULATION)).toString("latin1").split(/\r?\n/);
const header = csv[0]!.split(",");
const col = (n: string) => header.indexOf(n);
for (const line of csv.slice(1)) {
  const f = line.split(",");
  const level = f[col("SUMLEV")];
  if (level !== "162" && level !== "170" && level !== "061") continue; // places, consolidated cities, towns/townships
  const geoid = level === "061" ? `${f[col("STATE")]}${f[col("COUNTY")]}${f[col("COUSUB")]}` : `${f[col("STATE")]}${f[col("PLACE")]}`;
  population.set(geoid, Math.max(population.get(geoid) ?? 0, Number(f[col("POPESTIMATE2023")]) || 0));
}

const rows = new Map<string, string>();
const add = (state: string, name: string, lat: string, lon: string, pop: number, kind = "P") => {
  const key = `${name.toLowerCase()}|${state}`;
  const prev = rows.get(key);
  if (!prev || Number(prev.split("\t")[4]) < pop) rows.set(key, [name, state, lat, lon, pop, kind].join("\t"));
};
for (const line of unzipFirst(await download(GAZETTEER)).toString("utf8").split(/\r?\n/).slice(1)) {
  const f = line.split("\t").map((x) => x.trim());
  if (f.length < 12) continue;
  const [state, geoid, , raw] = f;
  for (const name of names(raw!)) add(state!, name, Number(f[10]).toFixed(3), Number(f[11]).toFixed(3), population.get(geoid!) ?? 0);
}
// County subdivisions: columns USPS, GEOID, ANSICODE, NAME, FUNCSTAT, ALAND, AWATER, ALAND_SQMI, AWATER_SQMI, INTPTLAT, INTPTLONG.
for (const line of unzipFirst(await download(COUSUBS)).toString("utf8").split(/\r?\n/).slice(1)) {
  const f = line.split("\t").map((x) => x.trim());
  if (f.length < 11 || !TOWNSHIP_STATES.has(f[0]!) || /\d|not defined/i.test(f[3]!)) continue;
  const [state, geoid, , raw] = f;
  for (const name of names(raw!)) {
    if (!rows.has(`${name.toLowerCase()}|${state}`)) add(state!, name, Number(f[9]).toFixed(3), Number(f[10]).toFixed(3), population.get(geoid!) ?? 0, "S");
  }
}

mkdirSync(path.dirname(OUT), { recursive: true });
// Everyday names the Census spells differently.
for (const [official, state, everyday] of [["Boise City", "ID", "Boise"], ["Salt Lake City", "UT", "Salt Lake"]] as const) {
  const row = rows.get(`${official.toLowerCase()}|${state}`);
  if (row) rows.set(`${everyday.toLowerCase()}|${state}`, [everyday, ...row.split("\t").slice(1)].join("\t"));
}
const body = ["name\tstate\tlat\tlon\tpop\tkind", ...[...rows.values()].sort()].join("\n");
writeFileSync(OUT, gzipSync(body, { level: 9 }));
console.log(`${rows.size} places → ${path.relative(process.cwd(), OUT)} (${Math.round(gzipSync(body).length / 1024)} KB)`);
