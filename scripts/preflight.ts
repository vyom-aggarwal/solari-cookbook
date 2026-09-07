/**
 * Phase 0, item 5 — establish the facts about THIS account that no docs page
 * can tell us: which plan, whether stealth exists for us, what a session's hard
 * wall-clock deadline actually is, and what the sandbox gateway will allow.
 *
 * Deliberately cheap. Every session it opens is released within seconds; the
 * whole run costs well under a cent. It probes concurrency only when asked
 * (`--probe-concurrency`), because that one deliberately provokes a 429.
 *
 *   npm run preflight -- [--probe-concurrency]
 */
import "dotenv/config"
import { Solari } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"
import { classify, reap, OWNER_TAG } from "./lease.js"

const BASE_URL = "https://api.getsolari.com"
const KEY = process.env.SOLARI_API_KEY

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(26)} ${value}`)
}

/** Minutes between now and an ISO deadline, to one decimal. */
function minutesUntil(iso: string): string {
  return `${((Date.parse(iso) - Date.now()) / 60_000).toFixed(1)} min`
}

async function publicHealth(): Promise<void> {
  console.log("\n[1] Browser gateway /health (unauthenticated)")
  const res = await fetch(`${BASE_URL}/health`)
  const body = (await res.json()) as {
    ok: boolean; idle: number; busy: number; saturated: boolean
    fast?: { idle: number; busy: number }
    stealth?: { idle: number; busy: number }
  }
  line("ok / saturated", `${body.ok} / ${body.saturated}`)
  line("warm total", `${body.idle} idle, ${body.busy} busy`)
  if (body.fast) line("fast pool", `${body.fast.idle} idle, ${body.fast.busy} busy`)
  if (body.stealth) line("stealth pool", `${body.stealth.idle} idle, ${body.stealth.busy} busy`)
}

async function browserFacts(solari: Solari): Promise<void> {
  console.log("\n[2] Browser session — plain")
  const t0 = performance.now()
  const session = await solari.sessions.create()
  line("created in", `${Math.round(performance.now() - t0)} ms`)
  line("session id", session.id)
  // The one number the docs never state: the plan-tier hard deadline. Anything
  // we design that assumes a long-lived browser has to fit inside this.
  line("expiresAt", `${session.expiresAt}  (${minutesUntil(session.expiresAt)} from now)`)
  await solari.sessions.releaseAndWait(session.id)
  line("released", "ok")

  console.log("\n[3] Browser session — stealth (is it on our plan?)")
  try {
    const s = await solari.sessions.create({ stealth: true })
    line("stealth", "AVAILABLE")
    line("expiresAt", `${s.expiresAt}  (${minutesUntil(s.expiresAt)} from now)`)
    await solari.sessions.releaseAndWait(s.id)
  } catch (err) {
    const f = classify(err)
    line("stealth", `UNAVAILABLE — ${f.kind} (${f.code ?? f.status ?? "?"})`)
    line("", f.message)
  }

  console.log("\n[4] Browser session — stealth + US residential proxy")
  try {
    const s = await solari.sessions.create({ stealth: true, proxy: { country: "us" } })
    line("proxy resolved", JSON.stringify(s.proxy ?? null))
    await solari.sessions.releaseAndWait(s.id)
  } catch (err) {
    const f = classify(err)
    line("proxy", `UNAVAILABLE — ${f.kind}: ${f.message}`)
  }

  console.log("\n[5] Profiles quota")
  try {
    const profiles = await solari.profiles.list()
    line("existing profiles", String(profiles.length))
  } catch (err) {
    line("profiles", classify(err).message)
  }
}

async function sandboxFacts(pt: SolariClient): Promise<void> {
  console.log("\n[6] Sandbox")
  const t0 = performance.now()
  try {
    const sbx = await pt.sandboxes.create({
      template: "base",
      timeoutMs: 60_000,
      metadata: { ...OWNER_TAG, probe: "preflight" },
    })
    line("created in", `${Math.round(performance.now() - t0)} ms`)
    line("sandboxId", sbx.sandboxId)
    line("expiresAt", `${sbx.expiresAt}  (${minutesUntil(sbx.expiresAt)} from now)`)
    try {
      const tc = performance.now()
      await sbx.connect()
      line("connect() in", `${Math.round(performance.now() - tc)} ms`)
      const out = await sbx.commands.run("sh", { args: ["-c", "uname -sr; nproc; free -m | head -2"] })
      console.log(out.stdout.trimEnd().split("\n").map((l) => `      ${l}`).join("\n"))
    } finally {
      await sbx.kill()
      line("killed", "ok")
    }
  } catch (err) {
    const f = classify(err)
    line("sandbox", `FAILED — ${f.kind} (${f.code ?? f.status ?? "?"})`)
    line("", f.message)
  }
}

/** Opens sessions until the gateway says no, then releases every one. */
async function probeConcurrency(solari: Solari): Promise<void> {
  console.log("\n[7] Concurrency cap (opening sessions until 429)")
  const open: string[] = []
  try {
    for (let i = 1; i <= 25; i++) {
      try {
        const s = await solari.sessions.create()
        open.push(s.id)
      } catch (err) {
        const f = classify(err)
        line("stopped at", `${open.length} concurrent — ${f.kind} (${f.code ?? f.status})`)
        return
      }
    }
    line("stopped at", `${open.length}+ (probe ceiling reached without a refusal)`)
  } finally {
    await Promise.all(open.map((id) => solari.sessions.releaseAndWait(id).catch(() => {})))
    line("released", `${open.length} sessions`)
  }
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error("SOLARI_API_KEY is not set. Put it in .env at the repo root (it is gitignored).")
    process.exitCode = 1
    return
  }
  console.log(`Solari preflight — key ${KEY.slice(0, 12)}…${KEY.slice(-4)}`)

  await publicHealth()

  const solari = new Solari({ apiKey: KEY, baseUrl: BASE_URL })
  const pt = new SolariClient({ apiKey: KEY, baseUrl: BASE_URL })
  try {
    await browserFacts(solari)
    await sandboxFacts(pt)
    if (process.argv.includes("--probe-concurrency")) await probeConcurrency(solari)

    const killed = await reap(pt)
    console.log(`\n[reaper] killed ${killed.length} leftover sandbox(es)${killed.length ? `: ${killed.join(", ")}` : ""}`)
  } finally {
    await solari.close()
  }
}

await main()
