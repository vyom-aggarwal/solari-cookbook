# Solari — condensed API map

Written during Phase 0. Sources, in descending order of trust:

1. **Measured** — I ran it and pasted the output. Marked `[RUN]`.
2. **Docs** — `docs.getsolari.com`, read on 2026-09-03. Marked `[DOC]`.
3. **Cookbook** — `github.com/solari-sdk/solari-cookbook`, all 9 examples read. Marked `[CB]`.
4. **Inferred** — not stated anywhere, my reading. Marked `[GUESS]` and never relied on.

Where two sources disagree, that is recorded in [Contradictions](#contradictions-found) rather than
silently resolved. `CLAUDE.md`'s "ground truth" section is *not* a source — it is itself partly
wrong, see below.

---

## 0. Status of this document

Phase 0 items 1 and 2 are complete. Items 3, 4 and 5 (run three examples, time cold starts,
confirm plan limits) are **blocked: there is no API key on this machine.** To be unambiguous:
**zero cookbook examples have been executed.** Not one has been run, cleanly or otherwise. Nothing
below is a report of an example's behaviour unless it carries `[RUN]`. No `.env` exists in the
repo, `SOLARI_API_KEY` is unset in the process, user, and machine environments, and no `slr_live_`
string exists anywhere under `Documents/Research` outside of placeholder text. Every section below
marked `[PENDING KEY]` is a hole that stays empty until a key exists. Nothing in it is guessed to
fill space.

---

## 1. Shape of the platform

One API key, format `slr_live_<id>_<secret>`, Bearer auth, base URL `https://api.getsolari.com`.
Three products bill to one balance: **browser** (a page), **sandbox** (headless code), **desktop**
(a screen; docs call these "VMs"). Two gateways behind the one host — a *browser* gateway and a
*VM* gateway — and they have **different error vocabularies and different response field names**
(`detail` vs `message`). `[DOC]`

### Packages — this is not what CLAUDE.md says

| Need | Package | Client | baseUrl |
| --- | --- | --- | --- |
| Browser | `@solarisdk/browser` @ 0.1.3 | `Solari` | optional |
| Sandbox | `@solarisdk/sandbox` @ 0.1.2 | `SandboxClient` | **required** `[CB]` |
| Desktop | `@solarisdk/desktop` @ 0.1.2 | `DesktopClient` | **required** `[CB]` |
| Sandbox + desktop, one client | `@solarisdk/sdk` @ 0.1.2 | `SolariClient` | defaults to prod `[CB]` |
| Shared runtime | `@solarisdk/core` @ 0.1.2 | — | — |
| Official MCP server | `@solarisdk/mcp` @ **0.4.3** | — | — |

`[RUN]` versions above are from `npm view`, 2026-09-03.

Two things worth internalising:

- **`@solarisdk/sdk` does not include the browser.** Its declared dependencies are `core`,
  `desktop`, `sandbox` — no browser. A program that drives all three installs two packages.
- **`@solarisdk/mcp` already exists at 0.4.3** and is far ahead of the SDKs in version number.
  Solari already ships an MCP server for *their primitives*. Phase 4's "ship an MCP server" must
  therefore expose **our product**, not re-wrap theirs, or it is dead on arrival.

Python: `solari-browser`, `solari-sandbox`, `solari-desktop` on PyPI. The standalone Python
clients also require `base_url` explicitly. `[CB]`

---

## 2. Browser

```ts
import { Solari } from "@solarisdk/browser"
const client = new Solari({ apiKey, baseUrl: "https://api.getsolari.com", region: "us-west" })
const browser = await client.launch({ stealth, recording, captcha, proxy, profileId })
const page = await browser.newPage()          // ordinary Playwright from here
await browser.close()                          // releases the session too
```

The SDK ships its own browser client. Adding Playwright or Patchright as a dependency is wrong.
`[DOC]`

**Bring your own client** is supported and may matter later: `sessions.create()` returns
`cdpEndpoint` and `wsEndpoint`, so Puppeteer / browser-use / playwright-core can attach.
`chromium.connect(wsEndpoint)` is pinned to `patchright-core@1.62.2`. `[DOC]`

**Release semantics** — three of them, and they are not interchangeable `[DOC]`:

| Call | Effect |
| --- | --- |
| `browser.close()` | shut down + clean up, safe in `finally` |
| `sessions.release(id)` | close without waiting |
| `sessions.releaseAndWait(id)` | wait for completion — **required before the replay is readable** |

### Stealth

`stealth: true` swaps in fingerprint patches and a headful browser on real GPU. It is the
**prerequisite for both `proxy` and `captcha`** — neither works without it. Aimed at Cloudflare,
DataDome, Akamai, PerimeterX. Costs more per second and is slower. Docs advise defaulting to
non-stealth and switching when you see a challenge page. `[DOC]`

### Proxy

```ts
proxy: { country: "us", tier: "residential" | "static" | "mobile", session: "warm-1" }
proxy: "us"        // shorthand [CB]
proxy: "smart"     // Solari picks and rotates on block [CB]
```

16 countries. `tier: "static"` is unavailable in India, South Korea and Mexico (12 of 16). The
`session` label pins the same IP across separate browser sessions — that is the mechanism for
multi-step logins that break when the IP moves. Confirm success by reading back `browser.proxy`
(country/tier/timezone), **not** by HTTP status. Billed per GB. `[DOC]` `[CB]`

Note `sessionDuration` appears in `/quickstart` `[DOC]` and in CLAUDE.md but **not** in the
`ProxyOptions` type on `/proxies` `[DOC]`. Unresolved; see contradictions.

### Captcha

`captcha: true` alongside `stealth: true`. Solves reCaptcha v2 (incl. invisible), v3, hCaptcha,
Turnstile automatically — by the time you submit the form it is already done, you write no solving
code. DataDome / PerimeterX / GeeTest / image-text are "site by site". Docs state no latency or
failure-mode behaviour; pricing puts it at $0.01/solve (Starter), $0.005 (Professional+). `[DOC]`

### Recording

`recording: true` **at launch**. Opt-in per session, no account-level switch; a session created
without it 404s on replay forever. Output is **rrweb NDJSON, gzipped — a DOM recording, not
video**, so it is greppable and diffable. Upload is async *after* release, so the first poll
normally 404s; retry ~30s. Two retrieval paths: `sessions.getReplayUrl(id)` for a shareable
expiring link, `sessions.download_replay(id)` for raw bytes. The HTTP client honours
`Content-Encoding` and hands back decompressed bytes — do **not** `gzip.decompress()` it. `[DOC]` `[CB]`

Retention by plan: 1 / 7 / 30 / 90 days. Recording captures form input **including passwords and
card numbers**. `[DOC]`

### Profiles

`profiles.create({name})` → `profiles.save(id, storageState)` → `launch({profileId})`. Stores
Playwright `storageState` (cookies + localStorage) server-side. **Attaching does not auto-save** —
you must call `save()` explicitly with `await page.context().storageState()`. `save()` returns
`{version, sizeBytes}`, so profiles are versioned. `[DOC]` `[CB]`

Security, quoted because it constrains our BYO-key design: *"A profile holds a real login. Anyone
with your API key can attach it to a session and act as that account."* `[DOC]`

---

## 3. Sandbox

```ts
const sbx = await sandboxes.create({
  template: "base",           // sandbox default
  cpu: 4,                     // 1-16, default 2
  memMb: 8192,                // 2048-65536, default 2048
  timeoutMs: 15 * 60_000,     // rolling IDLE window, default 30 min
  lifecycle: { onTimeout: "pause" | "kill" },
  fromSnapshot, volumes,
})
await sbx.connect()           // control channel; needed for files/git/code
```

`sbx.sandboxId` is the identifier — not `.id`. `[CB]`

- **`commands.run(cmd, {args, cwd, env, onStdout, onStderr})`** runs to completion. **Not
  shell-interpreted**: `run("ls -la")` looks for a binary named `ls -la`. Use `args`, or
  `run("sh", {args: ["-c", …]})`. It **waits for exit**, so a foreground server blocks until idle
  timeout — background it with `nohup … &` inside `sh -c`. `[DOC]` `[CB]`
- **`commands.start()`** for long-running work: handle with `stdin`, live streaming, `kill()`.
- **`pty.create({cols, rows})`** — real terminal emulation, colors and full-screen TUIs.
- **`runCode()`** — stateful kernel across calls. Python. Structured matplotlib extraction
  (`type`, `title`, axis labels, series) *alongside* a base64 PNG.
- **`git`** — typed `clone/status/add/commit/push/pull/checkout/branches/log`, results parsed for
  you, credentials passed per-call and never written to system config. `[DOC]`
- **`files`** — `write/readText/list/search/watch/upload/download`.
- **`previewUrl(port)`** — signed public URL, **one-hour** token, on `*.preview.getsolari.com`.
  Token as `pt_token` query param or `x-pinetree-preview-token` header. `401` = expired, call
  again. `425 Too Early` = nothing listening yet, poll. `[DOC]`

Lifecycle: `setTimeout(ms)`, `pause()` (state saved, **does not consume plan concurrency**),
`kill()` (permanent), `snapshot(name)`. `close()` only drops the local channel — the VM keeps
running and keeps billing. `[DOC]` `[CB]`

### Snapshots

`snapshot(name?)` → id, **taken while the machine keeps running**. `revert(snapshotId)` restores
in place, keeping the machine id — that is the "reset between test runs" primitive.
`create({fromSnapshot})` spawns independent machines from a prepared state. `[DOC]`

Constraints that bite:
- Snapshot of a **paused** machine → `409 NotRunning`.
- Delete with live/paused children → `409 SnapshotHasChildren`.
- Delete while backing a template → `409 SnapshotBacksTemplate`.

### Volumes

`volumes.create({name, sizeMb?, metadata?})` → `volumeId`; `list/get/delete` (delete idempotent).
Attach at create time via `volumes: [{volumeId, path}]`; paths absolute and unique per machine.
One volume can attach to **many machines at once** — that is the shared-state primitive, and a
better fit than snapshots for "many workers reading one dataset". `[DOC]`

### Templates

Ready-made: **`base`** (headless sandbox default), **`default`/`workstation`** (Ubuntu desktop),
**`office`**, **`code`** (git/Python/Node + browser VS Code). `[DOC]`

Custom templates use a declarative builder, steps applied in a fixed order
**apt → pip → run → env → workdir**:

```ts
const image = Image.base("ubuntu:22.04").kind("sandbox")
  .aptInstall([...]).pipInstall([...]).runCommands([...]).env({...}).workdir("/work")
const tpl = await templates.build(image, { name: "media-tools" })   // 202, async
```

A sandbox template cannot be used by `desktops.create()` and vice versa → `400
TemplateKindMismatch`. Ready-made templates cannot be deleted. `[DOC]`

---

## 4. Desktop / VM

`desktops.create({template: "default", resolution: "1280x720", timeoutMs})` → `sessionId`,
`streamUrl` (embeddable VNC, watchable live). `connect()`, then `health()` — **poll `health().ready`
before driving X11**, the machine answers before the GUI exists. `mouse.click(x, y, {humanize})`,
`keyboard.type()`, `screenshot({format})`, `open(binary)` → pid, `exec()`, clipboard, files.
`close()` drops the channel; **`destroy(sessionId)`** ends the session. Auto-pauses on idle
(default 30 min), resumes at the same CPU/memory. Paused VMs don't count against plan limits.
`[DOC]` `[CB]`

Cookbook flags two traps `[CB]`: `open()` fails if the binary isn't in the image (check with
`exec("command", {args:["-v", name]})`), and windows map into the **top-left quadrant** — clicking
screen-centre at 1280x720 lands *past* the window edge, focuses whatever is behind, and your
keystrokes vanish with no error. Always screenshot to confirm a click landed.

Desktop pool is separate: if `create` hangs or returns capacity errors, browsers and sandboxes are
unaffected. `[CB]`

---

## 5. Errors — the names we must handle

`[DOC]`, from `/errors`. Gateway column matters: the two gateways raise different sets.

| Code | HTTP | Gateway | Meaning | Retry? |
| --- | --- | --- | --- | --- |
| `FeatureRequiresPlan` | 402 | both | plan lacks the feature | no |
| `ConcurrencyLimitExceeded` | 429 | both | at the concurrent-session cap | no — free a slot |
| `PlanLimitExceeded` | 403 | browser | profile capacity reached | no |
| `ConcurrencyCheckUnavailable` | 503 | browser | concurrency store down | **yes, backoff** |
| `InvalidSessionId` | 404 | browser | malformed/forged id — *not* a no-op | no |
| `NotEntitled` | 403 | VM | plan excludes VMs/sandboxes | no |
| `InsufficientCredit` | 402 | VM | prepaid balance exhausted | no |
| `TemplateKindMismatch` | 400 | VM | sandbox template on a desktop, or vice versa | no |
| `TemplateNotReady` | 409 | VM | still building, or the build failed | no |
| `TemplateBuilding` | 409 | VM | can't delete mid-build | no |
| `SnapshotHasChildren` | 409 | VM | live VMs descend from it | no |
| `SnapshotBacksTemplate` | 409 | VM | a template depends on it | no |
| `NotRunning` | 409 | VM | snapshot attempted on a paused machine | no |
| `LocalFilesUnsupported` | 400 | VM | not implemented | no |
| `RecordingRequiresDesktop` | 400 | VM | recording asked for on a headless sandbox | no |
| `RecordingRequiresGoldenBoot` | 400 | VM | recording + snapshot/template | no |

Retry only `502/503/504` and transport faults (reset, DNS, timeout). **Never retry any 4xx**, and
never retry `501` — it is a statement of fact about configuration. `429` here means *"you are at
your cap"*, not *"slow down"*, so a backoff loop on it is pure waste. `[DOC]`

For VM-gateway creates, send `Idempotency-Key: <uuid-v4>` so a retried create doesn't leak a
second machine. **We should send this on every sandbox/desktop create from day one.** `[DOC]`

Response bodies: `error`, `code` (machine-readable — key off this), plus `detail` on the browser
gateway and `message` + `retryable` on the VM gateway. Status conventions: 201 create, 202 async
template build, 204 browser release, 200 otherwise. `[DOC]`

---

## 6. Pricing and limits — the constraint that shapes the product

> **PROVENANCE WARNING — this whole section is `[DOC]`, and `[DOC]` here means a marketing page
> read through a summarising fetch tool.** It is a *published tier table*, not a statement about
> our account. Nothing below has been observed from our key. Concurrency caps in particular are
> the kind of number that gets rounded for a pricing page and adjusted per-account in reality.
> **Do not treat any figure here as a measured limit.** `scripts/preflight.ts` replaces this
> section with observed values the moment a key exists; until then, anything that leans on these
> numbers is an assumption and should say so.

`[DOC]`, from `/pricing`.

| | Free | Starter | Professional | Enterprise |
| --- | --- | --- | --- | --- |
| Monthly | $0 | $20 | $200 | custom |
| Credits included | $3 | $20 | $200 | — |
| Browser $/hr *while open* | 0.15 | 0.10 | 0.07 | 0.05 |
| **Concurrent browsers** | **3** | **20** | **150** | 150+ |
| **Concurrent sandboxes/VMs** | **1** | **2** | **10** | 50+ |
| Profiles | 3 | 20 | 500 | unlimited |
| Replay retention | 1 d | 7 d | 30 d | 90 d |
| **Stealth** | **no** | included | included | included |
| Captcha | — | $0.01/solve | $0.005/solve | — |
| Proxy | — | $1.00/GB | $0.10/GB | — |
| Sandbox $/vCPU-hr | 0.0525 | 0.035 | 0.0245 | 0.0175 |
| Sandbox $/GB-hr | 0.0165 | 0.011 | 0.0077 | 0.0055 |
| VM live screen | +$0.02/hr | | | |

A 1 vCPU / 2 GB sandbox: **$0.086/hr** free, **$0.057/hr** starter, **$0.040/hr** professional.

Three numbers here decide the architecture, and all three are smaller than the plan assumed:

1. **Stealth is not on Free.** Proxy and captcha require stealth. So on a Free key, *the entire
   anti-bot half of the pitch is unavailable* — and if we hand it a Cloudflare-protected site it
   will not "work slower", it will fail.
2. **Concurrent sandboxes: 1 / 2 / 10.** Not hundreds. Any design that keeps a sandbox alive
   *per served API* dies at 10 users on the $200 plan. Sandboxes have to be **ephemeral workers
   for generate-and-validate**, never the serving tier.
3. **Concurrent browsers: 3 / 20 / 150.** "Validation is embarrassingly parallel, hundreds of
   concurrent browsers" is an Enterprise-only sentence. On Starter the honest number is ~20, and
   the free tier we give strangers has to fit inside a handful.

`pause()` not counting against plan limits `[DOC]` is the one release valve worth designing around.

---

## 7. Regions

One region today: **`us-west`** (N. California), the default, `api.getsolari.com`. Region is a
client-constructor option. Sessions, replays and profiles are region-bound; keys, billing and
**concurrency caps are global** (10 concurrent means 10 total, not 10 per region). Docs quote
200–400 ms session create + first paint near-region, +60–80 ms cross-country, +120–200 ms
international, each direction. `[DOC]`

---

## 8. Live capacity — measured

`GET /health` on the browser gateway is **unauthenticated** and reports warm-pool state. Solari
documents the endpoint and an example body on `/api-reference`. `[DOC]`

We use it, and we do not republish what it returns. Live capacity readings from someone else's
fleet are their operational data, not ours to post in a public repo — the samples we took and what
they implied have been moved to a private note that goes to Solari directly. What matters for our
design survives the move:

- The response reports **live warm capacity**, so a fan-out can be **sized at request time** rather
  than fixed at design time. It is free and needs no key.
- Readings **move substantially day to day**, so any single sample is a snapshot, not a ceiling.
  An earlier draft of these notes treated one low sample as a platform limit and reasoned from it.
  That was wrong, and it is the reason this file now insists on the distinction.
- `saturated` gives us an honest "queue it and say so" signal for Phase 3, and public `/health` is
  a legitimate input to our own `/health` endpoint.

`GET /healthz` (VM gateway) returns `401` on the public host, as documented. `[RUN]`

---

## 8b. What the shipped `.d.ts` says that the docs do not

`npm install` needs no key, so the SDK's own types are checkable right now — and they are a better
source than either the docs or CLAUDE.md. `[RUN]` read from `node_modules/@solarisdk/*/dist/*.d.ts`
at browser 0.1.3 / core, sandbox, desktop, sdk 0.1.2.

**Undocumented capability #1 — `webBotAuth`.** On `CreateSessionOptions`:

> *"Opt in to Cloudflare Web Bot Auth — sign every outbound HTTP request with an Ed25519 key
> registered to our verified bot directory. Independent of `stealth`. Silently inert if the
> acquired slot has no signing key configured."*

Not on any docs page I read. It is the *legitimate* counterpart to stealth: instead of hiding, you
cryptographically assert "I am a registered bot" to Cloudflare. **`Independent of stealth`** means
it may work on plans where stealth does not. "Silently inert" means you cannot tell from the return
value whether it did anything — that has to be measured against a real Cloudflare origin.

**Undocumented capability #2 — the proxy has far more knobs than `/proxies` lists.** The real
`ProxyRequest`: `country`, `tier`, `asn` (pin egress to an ASN, e.g. `"20057"` for AT&T Mobility),
`session`, **`sessionDuration` (1–30 min, default 10)**, **`state`** (US-only, e.g. `"california"`),
**`city`** (US-only, e.g. `"los_angeles"`), plus a deprecated `static` boolean. `proxy: "off"` is
also accepted. City/state/ASN-level egress targeting is a real capability that `/proxies` omits
entirely. `ResolvedProxyConfig` warns that **a `mobile` request can silently degrade to
residential** — compare what came back against what you asked for.

**Undocumented capability #3 — `launch()` self-heals.** `LaunchOptions` adds `retries` (default 0),
`probe` (health-check the browser before handing it back; defaults true when `retries > 0`) and
`probeTimeoutMs` (default 2000). There is a matching error code `BrowserUnhealthy` that appears in
the SDK's `SolariErrorCode` union but on **no** docs page. So the platform knows it sometimes hands
out bad browsers, and the SDK will silently re-roll one for you if you ask.

**`Session.expiresAt` — "Plan-tier deadline (ISO 8601 UTC); session auto-releases at this point."**
There is a hard wall-clock deadline per session, separate from the rolling idle
window, set by plan tier — and **the SDK tells us the exact timestamp at create time.** We do not
have to guess or discover it by dying — we can read it and schedule around it. `SessionHandle`
(sandboxes and desktops) carries `expiresAt` too.

**Two incompatible `SolariError` classes.** `@solarisdk/browser` exports one (`{status, code,
cause}`); `@solarisdk/core` exports a *different* base class with a real hierarchy — `GatewayError`,
`AuthError`, `PlanError`, `ConcurrencyLimitError`, `NoCapacityError`, `ActionError`, `TimeoutError`,
`ConnectionError`. **`instanceof` does not cross the package boundary.** Any error handler that
covers both browser and sandbox has to check both families and then fall back to the wire `code`.
Our `scripts/lease.ts` does exactly that.

**The reaper is a first-class API, not something we have to bolt on.** `create({metadata})` takes
opaque caller tags, `sandboxes.list({metadata, state, kind})` filters on them, and
`sandboxes.listAll()` is an async generator that follows `nextCursor` for you. `kill(id)` is
documented idempotent. So: tag every machine with our app + job id, and reaping leaks is a
five-line loop. `SandboxState` is `starting | running | paused | archived | releasing | gone`.

**`newIdempotencyKey()`** is exported from `@solarisdk/core` — use it on every VM create.

**Other corrections to §3 worth having:**
- `CommandOptions` has **`background: true`** (detach, output still streams). The cookbook's
  `nohup … &` shell trick is not required.
- `runCode` languages are `python | javascript | typescript | bash | r` — not Python-only.
- `RunCodeResult` has `results[]`, `error`, **and a flattened `charts[]`** convenience view.
- `previewUrl(port)` returns `{ url, token? }` — the token is optional, so code must handle its
  absence. CLAUDE.md was right and the cookbook example under-destructures.
- `files` is bigger than documented: `read/readText/write/list/stat/rename/remove/mkdir/search
  /watch/upload/download`, plus signed `downloadUrl()`/`uploadUrl()` that bypass the control
  channel for large files. `search` is a recursive in-guest grep.
- `snapshot(name?)` returns the id as a plain `string`. `promoteSnapshot(id, name)` turns a
  snapshot into a reusable **template** — a path neither `/snapshots` nor `/templates` mentions.
- `pause()` is annotated *"snapshot RAM+disk, **free the slot**"* — confirming paused machines
  release concurrency, which is the only lever we have against the 1/2/10 cap.
- **Volumes may not be real yet.** `volumes.mount` is annotated *"the gateway volume routes may be
  a 501 stub today."* Do not design anything load-bearing on volumes without testing first.

---

## 8c. Verification pass — three signatures checked against the live docs

I wrote §8b from the shipped `.d.ts`. Three of those claims were re-checked against
`docs.getsolari.com` on 2026-09-04, choosing the three whose being wrong would cost us most.
**All three held.** The cross-check surfaced four things the `.d.ts` alone did not.

| Claim in these notes | Docs page checked | Verdict |
| --- | --- | --- |
| `previewUrl(port)` → `{ url, token? }` | `/sandboxes` | ✅ *"the response also returns that token separately as `preview.token`"*; sample is `const { url, token } = await sbx.previewUrl(3000)` |
| `sandboxes.list({metadata})` filters, `listAll()` paginates | `/api-reference/sandboxes` | ✅ `GET /sandboxes` takes `state`, `kind`, `limit`, `cursor`, and repeatable `metadata.<key>` (e.g. `?metadata.project=acme`) |
| `getReplayUrl(id)` → `{url, expiresInSeconds, contentEncoding}` | `/api-reference/browser` | ✅ all three fields; `contentEncoding` *"defaults to `gzip`"* |

Found while verifying:

1. **`GET /sandboxes/:id/ports/:port` returns `501` when the deployment has no `previewDomain`.**
   Quoted: *"Port preview is not configured on this deployment (no `previewDomain`)"*. The guide
   page sells preview URLs unconditionally; the API reference admits they are deployment-gated.
   **Checked against production** `[RUN]` 2026-09-04: a wildcard `*.preview.getsolari.com`
   resolves, terminates TLS with a valid certificate, and returns `404` for a hostname that does
   not exist. So **production has a preview domain configured**; the `501` is the local/dev path.
   This does not yet prove our key can *mint* a preview URL — that needs the key — but the edge is
   there. (Addresses and the probe transcript are deliberately not reproduced here; they are
   Solari's infrastructure detail and went to them privately.)

2. **Every volumes route returns `501` when `VOLUMES_TABLE` is unset.** Confirms the `.d.ts`
   annotation. Volumes stay off the critical path until proven live.

3. **`expiresAt` is stamped `"now + plan.maxSessionMinutes"`.** The hard browser-session deadline
   is explicitly a per-plan constant, and is not mentioned on any guide page.

4. **`webBotAuth` is absent from `POST /sessions` in the API reference** even though it is on
   `CreateSessionOptions` in the SDK. Combined with its own *"silently inert"* annotation, treat it
   as unproven until measured against a real Cloudflare origin.

5. `sandboxes.list`/`listAll` and `promoteSnapshot` appear in the API reference but **not** on the
   `/sandboxes` guide page — the guide is a subset of the reference, so always check both.

---

## 9. Cold-start latency — [PENDING KEY]

Phase 0 item 4. Harness is written and ready at `scripts/phase0-bench.ts`; it does 10 serial cold
`launch()` and 10 serial cold `sandboxes.create()` and reports p50/p95/min/max. Serial, not
parallel, so it cannot trip a concurrency cap. Estimated cost of a full run: **under $0.05**.

| Operation | p50 | p95 | min | max | n |
| --- | --- | --- | --- | --- | --- |
| `launch()` cold | — | — | — | — | — |
| `launch({stealth:true})` cold | — | — | — | — | — |
| `sandboxes.create()` cold | — | — | — | — | — |

Docs claim ~1 s sandbox boot from memory snapshot `[CB]` and 200–400 ms browser session create
near-region `[DOC]`. Both unverified.

---

## 10. Account facts we cannot know without the key — [PENDING KEY]

- Which plan the key is on → **decides whether stealth/proxy/captcha exist for us at all**
- Actual concurrent browser and sandbox caps
- Remaining credit
- Whether a browser session has a hard wall-clock cap (see contradictions)

---

## Contradictions found

Recorded, not resolved. Each is a question for the key or for Solari.

1. **`CLAUDE.md`'s sandbox snippet does not match the cookbook.** It uses `SandboxClient` from
   `@solarisdk/sandbox` (matching `/sandboxes` `[DOC]`) while both TS sandbox examples use
   `SolariClient` from `@solarisdk/sdk` `[CB]`. It also writes `sbx.snapshot()`, `previewUrl()`
   returning `{url, token}`, and `runCode(src, {language: "python"})`. The cookbook shows
   `sandbox.sandboxId`, `previewUrl(port)` → `{url}`, and in Python a two-step
   `create_code_context("python")` + `run_code(src, context_id=ctx)` returning `result.results[]`
   with no top-level `.stdout`. **CLAUDE.md is a paraphrase and should not be trusted over the
   SDK's own types.** Resolve by reading the installed `.d.ts`.

2. **`solari.close()`: required or not?** The repo README says `browser.close()` alone suffices as
   of `@solarisdk/browser` 0.1.3, because the loopback retry listener is now unref'd. But
   `examples/browser-quickstart-ts/README.md` and the inline comments in all three browser TS
   examples still say it is REQUIRED and that you hang without it. The cookbook contradicts itself.
   → **first upstream issue, possibly first PR.**

3. ~~**`proxy.sessionDuration`.**~~ **RESOLVED** by reading `ProxyRequest` in the shipped types:
   `sessionDuration` is real, is in minutes, range 1–30, default 10, and only takes effect
   alongside `session`. The `/proxies` page is simply incomplete — it also omits `asn`, `state`
   and `city`. Trust the `.d.ts`.

4. **Stealth and the Free plan.** `/pricing` says stealth is not included on Free. `/stealth` says
   nothing about plan requirements and reads as universally available. One of the two pages is
   misleading. This is the most expensive contradiction on the list, because the default product
   idea is built on stealth.

5. **Session wall-clock lifetime — mechanism CONFIRMED, number still unknown.** No guide page
   mentions a wall-clock cap, and it is easy to read the docs and assume the only limit is the
   rolling idle window. There is a second, harder limit. `Session.expiresAt` is described in the
   shipped types as the *"plan-tier deadline (ISO 8601 UTC); session auto-releases at this point"*,
   and `/api-reference/browser` says it is stamped `"now + plan.maxSessionMinutes"`. So a hard
   deadline exists, it varies by plan, and **we can read the exact value at create time instead of
   discovering it by dying.** `scripts/preflight.ts` prints it. Ours is [PENDING KEY].

6. **CLAUDE.md's stated Solari facts are a paraphrase and are wrong in places.** Beyond the package
   confusion in (1): it omits `webBotAuth`, omits `background`, omits the proxy's `asn`/`state`/
   `city`, gets the code-interpreter call shape wrong, and asserts a "hundreds of concurrent
   browsers" capability the pricing page caps at 3/20/150. It is a useful orientation document and
   a bad reference. **The `.d.ts` beats the docs, and the docs beat CLAUDE.md.**

---

## A note on what this file deliberately does not contain

Two categories were removed from an earlier draft of these notes and moved to a private note sent
to Solari rather than published here:

1. **Live capacity readings from Solari's fleet**, taken from the unauthenticated `/health`
   endpoint. Using the endpoint is fine and we do. Publishing someone else's utilisation curve next
   to our own marketing is not our call to make.
2. **Third-party packages by other developers**, which an earlier draft named, characterised as
   competitors, and quoted for claims about Solari's platform. Public registry data does not make
   it appropriate to put a named individual's work and my guesses about their motives into a public
   repo attached to a job application. The one technical point that mattered is sourced from
   Solari's own SDK instead — see contradiction 5.

Rule going forward: **facts about Solari's API belong here; observations about Solari's operations
or about other people go to the people concerned.**
