/**
 * SPIKE half 2 of 2 — FIDELITY. The half that decides whether Geogrid is a
 * product or a lie.
 *
 * `city` and `state` exist only in the shipped .d.ts, on no documentation page.
 * If they are silently ignored, the grid is twelve pictures of the same place.
 *
 * Run SERIALLY on purpose: capacity is measured by the other script, and a
 * concurrency refusal here would be indistinguishable from a targeting failure.
 *
 * Two independent geolocation providers, queried from inside each proxied
 * session. Accuracy is scored by great-circle distance, not by city-name
 * equality -- the two providers disagree by ~15 km on one residential AT&T IP
 * from this machine (Stockton vs Lathrop, same ASN), so name matching would
 * fail a good result. Bar pre-registered in docs/SPIKE-GEOGRID.md.
 *
 *   npm run spike:fidelity [-- --runs 3] [--dry]
 */
import "dotenv/config"
import { Solari } from "@solarisdk/browser"
import type { ProxyRequest } from "@solarisdk/browser"
import { classify, withBrowser } from "./lease.js"

const BASE_URL = "https://api.getsolari.com"
const KEY = process.env.SOLARI_API_KEY
const TTL_MS = 120_000
const HIT_KM = 100
const NEAR_KM = 250

const WHOIS_URL = "https://ipwho.is/"
const IPAPI_URL =
  "http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,lat,lon,isp,org,as,asname,mobile,proxy,hosting,query"

type City = { key: string; label: string; lat: number; lon: number; proxy: ProxyRequest }

const CITIES: readonly City[] = [
  { key: "los_angeles", label: "Los Angeles", lat: 34.0522, lon: -118.2437,
    proxy: { country: "us", state: "california", city: "los_angeles" } },
  { key: "chicago", label: "Chicago", lat: 41.8781, lon: -87.6298,
    proxy: { country: "us", state: "illinois", city: "chicago" } },
  { key: "new_york", label: "New York", lat: 40.7128, lon: -74.006,
    proxy: { country: "us", state: "new_york", city: "new_york" } },
  { key: "dallas", label: "Dallas", lat: 32.7767, lon: -96.797,
    proxy: { country: "us", state: "texas", city: "dallas" } },
]

const COUNTRIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "de", label: "Germany" },
  { code: "jp", label: "Japan" },
]

const BOGUS: ProxyRequest = { country: "us", state: "nowhere", city: "nowhereville" }

type WhoIs = {
  success?: boolean; ip?: string; city?: string; region?: string; country_code?: string
  latitude?: number; longitude?: number
  connection?: { asn?: number; org?: string; isp?: string }
}
type IpApi = {
  status?: string; query?: string; city?: string; regionName?: string; countryCode?: string
  lat?: number; lon?: number; as?: string; asname?: string; isp?: string; org?: string
  hosting?: boolean; mobile?: boolean; proxy?: boolean
}

type Row = {
  target: string
  targetKey: string
  ip?: string
  whoisCity?: string
  ipapiCity?: string
  countryCode?: string
  asn?: string
  org?: string
  hosting?: boolean
  mobile?: boolean
  /** Best (smallest) distance in km from either provider to the target centroid. */
  km?: number
  /** How far apart the two providers put the same IP — the noise floor. */
  providerDeltaKm?: number
  error?: string
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

async function readJson<T>(page: { goto: (u: string, o?: object) => Promise<unknown>; evaluate: <R>(f: () => R) => Promise<R> }, url: string): Promise<T> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
  const text = await page.evaluate(() => document.body.innerText)
  return JSON.parse(text) as T
}

async function probe(
  solari: Solari,
  target: string,
  targetKey: string,
  proxy: ProxyRequest,
  centroid?: { lat: number; lon: number },
): Promise<Row> {
  try {
    return await withBrowser(solari, { stealth: true, proxy }, TTL_MS, async (browser) => {
      const page = await browser.newPage()
      const who = await readJson<WhoIs>(page, WHOIS_URL)
      const ipa = await readJson<IpApi>(page, IPAPI_URL)

      const dists: number[] = []
      if (centroid) {
        if (who.latitude !== undefined && who.longitude !== undefined)
          dists.push(haversineKm(who.latitude, who.longitude, centroid.lat, centroid.lon))
        if (ipa.lat !== undefined && ipa.lon !== undefined)
          dists.push(haversineKm(ipa.lat, ipa.lon, centroid.lat, centroid.lon))
      }
      const delta =
        who.latitude !== undefined && who.longitude !== undefined && ipa.lat !== undefined && ipa.lon !== undefined
          ? haversineKm(who.latitude, who.longitude, ipa.lat, ipa.lon)
          : undefined

      return {
        target, targetKey,
        ip: who.ip ?? ipa.query,
        whoisCity: [who.city, who.region].filter(Boolean).join(", ") || undefined,
        ipapiCity: [ipa.city, ipa.regionName].filter(Boolean).join(", ") || undefined,
        countryCode: (who.country_code ?? ipa.countryCode)?.toLowerCase(),
        asn: ipa.as ?? (who.connection?.asn ? `AS${who.connection.asn}` : undefined),
        org: ipa.isp ?? who.connection?.isp ?? who.connection?.org,
        hosting: ipa.hosting,
        mobile: ipa.mobile,
        km: dists.length ? Math.round(Math.min(...dists)) : undefined,
        providerDeltaKm: delta !== undefined ? Math.round(delta) : undefined,
      }
    })
  } catch (err) {
    const f = classify(err)
    return { target, targetKey, error: `${f.kind} (${f.code ?? f.status ?? "?"}): ${f.message}` }
  }
}

function scoreAndReport(cityRows: Row[], countryRows: Row[], bogus: Row, runs: number): void {
  console.log("\n### Per-session results\n")
  console.log("| Target | IP | ipwho.is | ip-api.com | dist km | Δ providers | ASN | org | hosting |")
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  for (const r of [...cityRows, ...countryRows, bogus]) {
    if (r.error) { console.log(`| ${r.target} | — | **${r.error}** | | | | | | |`); continue }
    console.log(
      `| ${r.target} | ${r.ip ?? "?"} | ${r.whoisCity ?? "?"} | ${r.ipapiCity ?? "?"} | ` +
        `${r.km ?? "—"} | ${r.providerDeltaKm ?? "—"} | ${r.asn ?? "?"} | ${r.org ?? "?"} | ` +
        `${r.hosting === undefined ? "?" : r.hosting ? "**DATACENTER**" : "residential"} |`,
    )
  }

  const ok = cityRows.filter((r) => !r.error)
  const hits = ok.filter((r) => r.km !== undefined && r.km <= HIT_KM)
  const nears = ok.filter((r) => r.km !== undefined && r.km <= NEAR_KM)
  const f1 = ok.length ? hits.length / ok.length : 0

  const perCity = CITIES.map((c) => {
    const rs = ok.filter((r) => r.targetKey === c.key)
    const h = rs.filter((r) => r.km !== undefined && r.km <= HIT_KM).length
    return { city: c.label, hits: h, of: rs.length, stable: h >= 2 }
  })
  const f2 = perCity.filter((p) => p.stable).length

  const allRows = [...cityRows, ...countryRows].filter((r) => !r.error && r.ip)
  const ips = allRows.map((r) => r.ip as string)
  const uniqueRatio = ips.length ? new Set(ips).size / ips.length : 0
  const byIp = new Map<string, Set<string>>()
  for (const r of allRows) {
    const set = byIp.get(r.ip as string) ?? new Set<string>()
    set.add(r.targetKey)
    byIp.set(r.ip as string, set)
  }
  const crossCity = [...byIp.entries()].filter(([, keys]) => keys.size > 1)

  const classified = allRows.filter((r) => r.hosting !== undefined)
  const residential = classified.filter((r) => r.hosting === false)
  const f4 = classified.length ? residential.length / classified.length : 0

  const deltas = allRows.map((r) => r.providerDeltaKm).filter((d): d is number => d !== undefined).sort((a, b) => a - b)
  const medianDelta = deltas.length ? deltas[Math.floor(deltas.length / 2)] : undefined

  const pct = (x: number) => `${Math.round(x * 100)}%`
  console.log("\n### Scored against the pre-registered bar\n")
  console.log(`  F1 accuracy      ${pct(f1)} hits within ${HIT_KM} km  (${hits.length}/${ok.length}); ` +
    `${nears.length}/${ok.length} within ${NEAR_KM} km        threshold >=70%  -> ${f1 >= 0.7 ? "PASS" : "FAIL"}`)
  console.log(`  F2 stability     ${f2}/4 cities with >=2 of ${runs} runs hitting                       threshold >=3    -> ${f2 >= 3 ? "PASS" : "FAIL"}`)
  console.log(`  F3 distinctness  ${pct(uniqueRatio)} unique IPs, ${crossCity.length} IP(s) reused across cities   threshold >=90%, 0 reuse -> ${uniqueRatio >= 0.9 && crossCity.length === 0 ? "PASS" : "FAIL"}`)
  console.log(`  F4 residential   ${pct(f4)} non-hosting (${residential.length}/${classified.length})                          threshold >=70%  -> ${f4 >= 0.7 ? "PASS" : "FAIL"}`)

  const bogusSucceeded = !bogus.error
  const f5Fatal = bogusSucceeded && f1 < 0.7
  console.log(`  F5 inertness     bogus city ${bogusSucceeded ? `SILENTLY SUCCEEDED (landed ${bogus.ipapiCity ?? bogus.whoisCity ?? "?"})` : `ERRORED: ${bogus.error}`}`)
  console.log(`                   fatal only if silent AND F1<70%          -> ${f5Fatal ? "FATAL" : "not fatal"}`)
  if (medianDelta !== undefined) console.log(`  noise floor      median provider disagreement ${medianDelta} km`)

  const passes = [f1 >= 0.7, f2 >= 3, uniqueRatio >= 0.9 && crossCity.length === 0, f4 >= 0.7, !f5Fatal]
  const marginal = [f1 >= 0.6 && f1 < 0.7, f4 >= 0.6 && f4 < 0.7, uniqueRatio >= 0.8 && uniqueRatio < 0.9]
  const verdict = passes.every(Boolean) ? "PASS" : marginal.some(Boolean) ? "AMBIGUOUS" : "FAIL"
  console.log(`\n  FIDELITY VERDICT: ${verdict}`)
  console.log(`  ${verdict === "PASS" ? "PLAN.md is authorised (subject to the capacity half)." : "PLAN.md is NOT authorised. Bring the numbers back and re-pick."}`)
  if (f4 < 0.7 && f1 >= 0.7)
    console.log(`  NOTE: F1 passed but F4 failed — accurate city labels on datacenter IPs. Technically\n` +
      `  correct, strategically dead: that is twelve VPSes, and the moat is gone.`)
}

async function main(): Promise<void> {
  const i = process.argv.indexOf("--runs")
  const runs = i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 3
  const total = CITIES.length * runs + COUNTRIES.length + 1

  if (process.argv.includes("--dry")) {
    console.log(`Plan: ${CITIES.length} cities x ${runs} runs + ${COUNTRIES.length} countries + 1 bogus = ` +
      `${total} stealth+proxy sessions, SERIAL, ~20s each. Under $0.05. No key needed for --dry.`)
    return
  }
  if (!KEY) {
    console.error(
      "BLOCKED: SOLARI_API_KEY is not set. Fidelity is the half that decides whether Geogrid is\n" +
        "real, and it cannot be measured without a key. Nothing is inferred in its place.\n" +
        "  printf 'SOLARI_API_KEY=slr_live_...\\n' > ../.env",
    )
    process.exitCode = 1
    return
  }

  console.log(`Fidelity spike — ${total} serial stealth+proxy sessions`)
  const solari = new Solari({ apiKey: KEY, baseUrl: BASE_URL })
  try {
    const cityRows: Row[] = []
    for (let r = 1; r <= runs; r++) {
      for (const c of CITIES) {
        cityRows.push(await probe(solari, `${c.label} #${r}`, c.key, c.proxy, { lat: c.lat, lon: c.lon }))
        process.stdout.write(".")
      }
    }
    const countryRows: Row[] = []
    for (const c of COUNTRIES) {
      countryRows.push(await probe(solari, c.label, c.code, { country: c.code }))
      process.stdout.write(".")
    }
    const bogus = await probe(solari, "Nowhereville, XX (control)", "bogus", BOGUS)
    process.stdout.write(".\n")

    scoreAndReport(cityRows, countryRows, bogus, runs)
  } finally {
    await solari.close()
  }
}

await main()
