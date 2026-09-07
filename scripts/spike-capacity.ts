/**
 * SPIKE half 1 of 2 — CAPACITY, measured against OUR account.
 *
 * Everything this replaces was a marketing tier table read through a summarising
 * fetch tool. The published 3/20/150 browser and 1/2/10 sandbox figures have
 * never been observed from our key, and an earlier draft of the decision doc
 * used them to rule out an architecture as though they had been. This measures.
 *
 * Facts recorded: plan capability, real concurrent caps, plan.maxSessionMinutes.
 * Then the actual product question: can we hold 12 concurrent STEALTH sessions.
 *
 * Bar is pre-registered in docs/SPIKE-GEOGRID.md and is not editable from here:
 *   PASS >= 12 held, no ConcurrencyLimitExceeded, no NoCapacityError
 *   CONDITIONAL 6..11 held        FAIL < 6
 *
 * Session budget: up to 20 plain + up to 12 sandboxes + 12 stealth, each alive
 * for seconds. Under $0.05 at any plan rate. Run it with --dry to see the plan
 * without spending anything.
 *
 *   npm run spike:capacity [-- --dry]
 */
import "dotenv/config"
import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"
import { classify, OWNER_TAG, reap } from "./lease.js"

const BASE_URL = "https://api.getsolari.com"
const KEY = process.env.SOLARI_API_KEY
const BROWSER_RAMP_MAX = 20
const SANDBOX_RAMP_MAX = 12
const STEALTH_TARGET = 12

function head(s: string): void {
  console.log(`\n${s}\n${"-".repeat(s.length)}`)
}
function line(k: string, v: string): void {
  console.log(`  ${k.padEnd(30)} ${v}`)
}
function minutesUntil(iso: string): number {
  return Math.round((Date.parse(iso) - Date.now()) / 60_000)
}

/** Facts that replace the unverified tier table in SOLARI-NOTES §6. */
async function accountFacts(solari: Solari): Promise<{ stealthOk: boolean }> {
  head("A. Account facts")

  const plain = await solari.sessions.create()
  line("plain session", plain.id)
  line("plan.maxSessionMinutes", `${minutesUntil(plain.expiresAt)} min  (expiresAt ${plain.expiresAt})`)
  await solari.sessions.releaseAndWait(plain.id)

  let stealthOk = false
  try {
    const s = await solari.sessions.create({ stealth: true })
    stealthOk = true
    line("stealth", "AVAILABLE on this plan")
    line("stealth maxSessionMinutes", `${minutesUntil(s.expiresAt)} min`)
    await solari.sessions.releaseAndWait(s.id)
  } catch (err) {
    const f = classify(err)
    line("stealth", `UNAVAILABLE — ${f.kind} (${f.code ?? f.status ?? "?"}): ${f.message}`)
  }

  try {
    const p = await solari.sessions.create({ stealth: true, proxy: { country: "us" } })
    line("stealth+proxy", `OK — gateway resolved ${JSON.stringify(p.proxy ?? null)}`)
    await solari.sessions.releaseAndWait(p.id)
  } catch (err) {
    const f = classify(err)
    line("stealth+proxy", `UNAVAILABLE — ${f.kind}: ${f.message}`)
  }

  // No documented account/balance endpoint exists on either SDK. Deliberately
  // NOT going fishing for an undocumented one -- see private/SOLARI-DISCLOSURE.md.
  line("credit balance", "not exposed by the SDK — read it from console.getsolari.com")
  return { stealthOk }
}

/** Open sessions one at a time until refused; report where and with what. */
async function rampBrowsers(solari: Solari): Promise<void> {
  head(`B. Concurrent browser cap (ramping to ${BROWSER_RAMP_MAX})`)
  const open: string[] = []
  try {
    for (let i = 1; i <= BROWSER_RAMP_MAX; i++) {
      try {
        open.push((await solari.sessions.create()).id)
      } catch (err) {
        const f = classify(err)
        line("observed cap", `${open.length} concurrent`)
        line("refused with", `${f.kind} (${f.code ?? f.status ?? "?"})`)
        line("interpretation", f.kind === "concurrency"
          ? "OUR plan is the limit — money fixes this"
          : f.kind === "no-capacity"
            ? "SOLARI's pool is the limit — money does not fix this"
            : f.message)
        return
      }
    }
    line("observed cap", `>= ${open.length} (hit the ramp ceiling without refusal)`)
  } finally {
    await Promise.all(open.map((id) => solari.sessions.releaseAndWait(id).catch(() => {})))
    line("released", `${open.length} sessions`)
  }
}

async function rampSandboxes(pt: SolariClient): Promise<void> {
  head(`C. Concurrent sandbox cap (ramping to ${SANDBOX_RAMP_MAX})`)
  const open: string[] = []
  try {
    for (let i = 1; i <= SANDBOX_RAMP_MAX; i++) {
      try {
        const sbx = await pt.sandboxes.create({
          template: "base",
          timeoutMs: 60_000,
          metadata: { ...OWNER_TAG, probe: "capacity" },
        })
        open.push(sbx.sandboxId)
      } catch (err) {
        const f = classify(err)
        line("observed cap", `${open.length} concurrent`)
        line("refused with", `${f.kind} (${f.code ?? f.status ?? "?"}): ${f.message}`)
        return
      }
    }
    line("observed cap", `>= ${open.length} (hit the ramp ceiling without refusal)`)
  } finally {
    await Promise.all(open.map((id) => pt.sandboxes.kill(id).catch(() => {})))
    line("killed", `${open.length} sandboxes`)
  }
}

/** The product question: twelve stealth browsers, actually connected, at once. */
async function holdStealth(solari: Solari): Promise<void> {
  head(`D. Hold ${STEALTH_TARGET} concurrent stealth sessions — the pre-registered test`)
  const browsers: Array<{ close: () => Promise<void> }> = []
  const errors: string[] = []
  try {
    const results = await Promise.allSettled(
      Array.from({ length: STEALTH_TARGET }, () => solari.launch({ stealth: true })),
    )
    for (const r of results) {
      if (r.status === "fulfilled") browsers.push(r.value)
      else {
        const f = classify(r.reason)
        errors.push(`${f.kind} (${f.code ?? f.status ?? "?"})`)
      }
    }
    const held = browsers.length
    line("held simultaneously", `${held} / ${STEALTH_TARGET}`)
    if (errors.length) {
      const tally = new Map<string, number>()
      for (const e of errors) tally.set(e, (tally.get(e) ?? 0) + 1)
      for (const [e, n] of tally) line("refused", `${n} x ${e}`)
    }
    const concurrency = errors.some((e) => e.startsWith("concurrency"))
    const capacity = errors.some((e) => e.startsWith("no-capacity"))
    const verdict = held >= STEALTH_TARGET && !concurrency && !capacity
      ? "PASS"
      : held >= 6
        ? "CONDITIONAL — grid ships narrower than 12"
        : "FAIL"
    line("CAPACITY VERDICT", verdict)
    if (concurrency) line("ceiling type", "ConcurrencyLimitExceeded — our plan")
    if (capacity) line("ceiling type", "NoCapacityError — Solari's pool")
  } finally {
    await Promise.all(browsers.map((b) => b.close().catch(() => {})))
    line("closed", `${browsers.length} browsers`)
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--dry")) {
    console.log(
      `Plan: ${BROWSER_RAMP_MAX} plain sessions (serial ramp), ${SANDBOX_RAMP_MAX} sandboxes ` +
        `(serial ramp), ${STEALTH_TARGET} stealth browsers (concurrent), each alive seconds. ` +
        `Under $0.05 total. No key needed for --dry.`,
    )
    return
  }
  if (!KEY) {
    console.error(
      "BLOCKED: SOLARI_API_KEY is not set. Capacity cannot be measured against our account.\n" +
        "  printf 'SOLARI_API_KEY=slr_live_...\\n' > ../.env",
    )
    process.exitCode = 1
    return
  }

  const solari = new Solari({ apiKey: KEY, baseUrl: BASE_URL })
  const pt = new SolariClient({ apiKey: KEY, baseUrl: BASE_URL })
  try {
    const { stealthOk } = await accountFacts(solari)
    await rampBrowsers(solari)
    await rampSandboxes(pt)
    if (stealthOk) await holdStealth(solari)
    else console.log("\nD. SKIPPED — stealth is not available on this plan, so the grid cannot exist as designed.")
    const killed = await reap(pt)
    console.log(`\n[reaper] killed ${killed.length} leftover sandbox(es)`)
  } finally {
    await solari.close()
  }
}

await main()
