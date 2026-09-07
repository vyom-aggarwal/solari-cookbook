/**
 * Phase 0, item 4 — time cold starts. Solari's pitch is speed; if we are going
 * to repeat that claim in a README we should be the ones who measured it.
 *
 * Serial by construction: one resource alive at a time, so this cannot trip a
 * concurrency cap however small the plan is. 10 browser launches + 10 sandbox
 * creates, each alive for a second or two, costs well under $0.05.
 *
 *   npm run bench -- [--n 10] [--stealth]
 */
import "dotenv/config"
import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"
import { classify, OWNER_TAG, withBrowser, withSandbox } from "./lease.js"

const BASE_URL = "https://api.getsolari.com"
const KEY = process.env.SOLARI_API_KEY
const TTL_MS = 60_000

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  // Nearest-rank. With n=10 that makes p95 the slowest sample, which is the
  // honest reading of ten data points — don't dress it up as more.
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(rank, sorted.length) - 1]!
}

type Row = { label: string; samples: number[]; failures: string[] }

function report(rows: Row[]): void {
  console.log("\n| Operation | p50 | p95 | min | max | n | failed |")
  console.log("| --- | --- | --- | --- | --- | --- | --- |")
  for (const r of rows) {
    const s = [...r.samples].sort((a, b) => a - b)
    const ms = (v: number) => (Number.isNaN(v) ? "—" : `${Math.round(v)} ms`)
    console.log(
      `| \`${r.label}\` | ${ms(pct(s, 50))} | ${ms(pct(s, 95))} | ${ms(s[0] ?? NaN)} | ` +
        `${ms(s[s.length - 1] ?? NaN)} | ${s.length} | ${r.failures.length} |`,
    )
  }
  for (const r of rows) {
    for (const f of new Set(r.failures)) console.log(`  ${r.label} failure: ${f}`)
  }
}

/**
 * Run one attempt, recording failures against `row`. The acquisition time is
 * recorded by the caller at the moment the lease callback is entered — by then
 * `launch()`/`create()` has resolved, so it excludes teardown.
 */
async function attempt(row: Row, run: (t0: number) => Promise<void>): Promise<void> {
  const t0 = performance.now()
  try {
    await run(t0)
  } catch (err) {
    const f = classify(err)
    row.failures.push(`${f.kind} (${f.code ?? f.status ?? "?"}) ${f.message}`)
  }
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error("SOLARI_API_KEY is not set. Put it in .env at the repo root (it is gitignored).")
    process.exitCode = 1
    return
  }
  const n = arg("n", 10)
  const wantStealth = process.argv.includes("--stealth")
  console.log(`Cold-start bench — ${n} serial runs per operation${wantStealth ? ", incl. stealth" : ""}`)

  const solari = new Solari({ apiKey: KEY, baseUrl: BASE_URL })
  const pt = new SolariClient({ apiKey: KEY, baseUrl: BASE_URL })

  const launch: Row = { label: "launch()", samples: [], failures: [] }
  const launchStealth: Row = { label: "launch({stealth:true})", samples: [], failures: [] }
  const create: Row = { label: "sandboxes.create()", samples: [], failures: [] }
  const connect: Row = { label: "sandbox connect()", samples: [], failures: [] }

  try {
    for (const [row, opts] of [
      [launch, {}] as const,
      ...(wantStealth ? [[launchStealth, { stealth: true }] as const] : []),
    ]) {
      for (let i = 0; i < n; i++) {
        await attempt(row, async (t0) => {
          await withBrowser(solari, opts, TTL_MS, async (b) => {
            row.samples.push(performance.now() - t0)
            // Prove the browser is really drivable, not just allocated.
            await b.newPage()
          })
        })
        process.stdout.write(".")
      }
      process.stdout.write("\n")
    }

    for (let i = 0; i < n; i++) {
      await attempt(create, async (t0) => {
        await withSandbox(
          pt,
          { template: "base", timeoutMs: 60_000, metadata: { ...OWNER_TAG, probe: "bench" } },
          TTL_MS,
          async (sbx) => {
            create.samples.push(performance.now() - t0)
            const t = performance.now()
            await sbx.connect()
            connect.samples.push(performance.now() - t)
          },
        )
      })
      process.stdout.write(".")
    }
    process.stdout.write("\n")

    report(wantStealth ? [launch, launchStealth, create, connect] : [launch, create, connect])
  } finally {
    await solari.close()
  }
}

await main()
