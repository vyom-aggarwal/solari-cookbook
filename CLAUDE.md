# CLAUDE.md — Project rules

This file is loaded automatically by Claude Code every session. Follow it exactly.

---

## 1. What this project is

A public, working product built on **Solari** (cloud browsers, sandboxes, and desktops behind one API key), submitted to the Pinetree Research SWE internship challenge.

The judges are the people who built Solari. They will read the code. Assume they know their own API better than we do, and that they can tell a real integration from a demo that calls `sleep()` and prints a fake result.

**The single judging criterion that matters:** *"A great use case is one that fits the needs/demands of the market → get people to use your build."*

So every decision resolves against two questions:
1. Would a stranger use this twice?
2. Does it do something that is *hard or impossible* without Solari?

If the answer to (2) is "you could just run Playwright locally," the idea is wrong and you should say so instead of building it.

---

## 2. Solari ground truth

Verified from `docs.getsolari.com` and `github.com/solari-sdk/solari-cookbook`. Treat this as a starting map, **not** as a substitute for reading the docs — check the live docs before using any surface not listed here.

**One key for everything.** Format `slr_live_…`, from `console.getsolari.com`. Base URL `https://api.getsolari.com`. Browsers, sandboxes, and desktops all bill to the same balance.

**Packages**
```
npm install @solarisdk/browser     # cloud Chrome, Playwright API
npm install @solarisdk/sandbox     # headless microVM, run code
npm install @solarisdk/desktop     # Linux VM with X11 + VNC
```
Python: `solari_sandbox` / `solari_desktop` on PyPI. Go and Rust bindings exist. TypeScript is the reference implementation — prefer it unless there's a reason not to.

**Browser**
```ts
import { Solari } from "@solarisdk/browser"
const client = new Solari({ apiKey: process.env.SOLARI_API_KEY!, baseUrl: "https://api.getsolari.com" })
const browser = await client.launch({ stealth: true, recording: true, captcha: true,
  proxy: { country: "us", session: "warmup-1", sessionDuration: 10 } })
const page = await browser.newPage()          // full Playwright page API
const sessionId = browser.id
await browser.close()
const { url } = await client.sessions.getReplayUrl(sessionId)
```
The SDK ships its own browser client — do **not** add Playwright or Patchright as a dependency.

**Sandbox**
```ts
import { SandboxClient } from "@solarisdk/sandbox"
const sandboxes = new SandboxClient({ apiKey: process.env.SOLARI_API_KEY!, baseUrl: "https://api.getsolari.com" })
const sbx = await sandboxes.create({ template: "base", cpu: 4, memMb: 8192,
  timeoutMs: 15 * 60 * 1000, lifecycle: { onTimeout: "pause" } })
await sbx.connect()
await sbx.commands.run("sh", { args: ["-c", "echo hi"], cwd: "/opt/app", env: {}, onStdout: d => {} })
await sbx.runCode("x = 1", { language: "python" })   // stateful kernel across calls
await sbx.files.write("/tmp/a.txt", "b"); await sbx.files.readText("/tmp/a.txt")
await sbx.git.clone(url, { path, depth: 1 })         // typed git namespace, per-call creds
const { url: preview, token } = await sbx.previewUrl(3000)
const snapId = await sbx.snapshot("after-setup")
const fork = await sandboxes.create({ template: "base", fromSnapshot: snapId })
await sbx.kill()
```

### Gotchas that cost an afternoon each

These are documented by Solari themselves. Do not rediscover them.

- **`browser.close()` ends the session.** Also `await client.close()` to release the connection pool. On `@solarisdk/browser` < 0.1.3 the client close was required or the process hangs after printing.
- **Recording is per-session, not per-account.** Pass `recording: true` at launch or the replay endpoint 404s forever. Upload is async after release — poll ~30s before giving up.
- **Sandbox commands are not shell-interpreted.** `run("ls -la")` looks for a binary literally named `ls -la`. Use `run("ls", { args: ["-la"] })` or `run("sh", { args: ["-c", "..."] })`.
- **`kill()` ends a VM, `close()` does not.** `close()` only drops the local control channel; the machine keeps running and keeps billing until idle timeout.
- **`timeoutMs` is a rolling idle window, not a hard deadline.** It resets on every use. A busy machine never times out on its own — you must kill it.
- **Preview URLs are signed and expire.** One-hour `pt_token` query param, or send it as the `x-pinetree-preview-token` header. `401` = expired/missing, call `previewUrl()` again. `425 Too Early` = nothing listening on that port yet, poll.
- **Structured matplotlib `chart` data may be empty on some templates.** The base64 PNG on `results[i].png` is always there — fall back to it.

---

## 3. Hard rules

1. **No mock data. Ever.** Every code path that claims to talk to Solari talks to Solari. If a feature isn't wired to the real API yet, it does not appear in the UI, the README, or the demo. Fake progress bars, `setTimeout` "processing", and hardcoded sample results are disqualifying.
2. **Never write a real API key into a tracked file.** `.env` is gitignored from commit one. Add a `.env.example` with placeholders. Before every commit, grep the diff for `slr_live_`, `sk-`, `ghp_`, and `Bearer`.
3. **Verify by running, not by reading.** A task is done when the command has been executed and the real output pasted into the session — not when the code "looks right."
4. **Every Solari resource gets a `finally { kill() }`.** Leaked sandboxes and browsers burn credits silently. Wrap every acquisition in a lease helper with a hard TTL, and add a reaper that lists and kills orphans on boot.
5. **Budget discipline.** Credits are finite. Before any change that fans out concurrency, state the expected session count and cost, then wait for approval. Default local dev concurrency: 2. Never loop-retry a failing Solari call more than 3 times with backoff.
6. **Stop and ask when the plan changes.** If reality contradicts the plan (an API doesn't do what we assumed, a library doesn't exist), stop, report the contradiction, propose two options. Do not silently substitute a different approach.
7. **Legal and ethical footing.** Public data only. Respect `robots.txt` and posted rate limits. Only authenticate to sites the operator owns or has permission for, with the operator's own credentials. No paywall circumvention, no scraping of personal data. Put this in the README as a "Scope and limits" section — it reads as maturity, not weakness.

---

## 4. Definition of done for any task

- [ ] Runs end to end against the live Solari API with real output shown in the transcript
- [ ] Has a test that would fail if the integration broke (not a snapshot of a mock)
- [ ] Handles the failure path: auth error, no capacity, concurrency limit, timeout, target site down
- [ ] Every acquired resource is released on both the success and error path
- [ ] Typechecks and lints clean
- [ ] Committed with a message that explains *why*, not *what*

---

## 5. Style

- TypeScript, strict mode, no `any` in code we control.
- Structured logging with a run/job id on every line. The judges will read logs from the demo.
- Small files, obvious names, no framework unless it earns its dependency.
- Comments only where behavior is surprising — and put them where the surprise is, not at the top of the file.
- Errors carry context: which Solari session, which URL, which attempt.

---

## 6. Things that make this lose

Read this list before every commit.

- A README that describes a product the code doesn't implement.
- A demo video showing a happy path that only works on one hardcoded input.
- Solari used as a fancy `fetch` — one page load, no stealth, no parallelism, no sandbox, nothing that needs the platform.
- Impressive architecture diagram, broken deploy link.
- "It works on my machine" — no public URL a stranger can click.
- Anything the judges have to install to evaluate.
