# Which product — one page, three candidates

Written 2026-09-04, after Phase 0. Nothing here is committed to until the spike at the bottom
passes.

**Assumption I had to make:** the time budget in the brief came through as an unfilled placeholder,
so every "finishable" score below is against the example figure — **5 evenings + 2 full weekend
days, ≈ 35 focused hours**, of which Phase 3 (survivability) and Phase 4 (distribution) need at
least 12. That leaves ~23 hours of build. Correct me and the scores move.

The criterion everything resolves against, quoted from the challenge: *a great use case fits real
market demand, and people actually use it.* A polished thing nobody uses loses to a rough thing
with fifty real users. So "finishable" is not a tiebreaker here — an unshipped, undistributed
product scores zero on the only axis being graded.

---

## A — Self-healing scraper API *(the brief's default)*

Point it at any URL, describe the fields in English, get back a live JSON endpoint that re-derives
its own selectors when the site changes.

**Who specifically wants this.** An indie developer or analyst who needs structured data from a
site with no API — a competitor's pricing page, a directory, a listings site — and does not want to
own a scraper. Today they either hand-write Playwright and re-fix it every few weeks, pay for
Firecrawl / Browse AI / Apify / Kadoa, or copy-paste into a spreadsheet.

**Solari primitives required.** Browser (explore the real DOM) · stealth + proxy + captcha
(protected targets) · sandbox (execute LLM-written code off our process) · snapshot + fork (roll
back to the last good extractor) · parallel browsers (validate against several live pages) ·
preview URL (serve it).

**What breaks without Solari.** Three things genuinely break: executing model-written code safely,
residential egress against sites that block datacenter IPs, and rollback of a *warm* prepared state.
But an honest reading is that a determined developer gets 80% of this with Docker, a BrightData
contract and a Fly machine. It is *hard* without Solari, not *impossible*.

**Architecture correction Phase 0 forces — flagged UNVERIFIED.** The published price-tier table
lists concurrent sandboxes at **1 / 2 / 10 / 50+** and concurrent browsers at **3 / 20 / 150**,
which would mean a sandbox-per-served-API dies at ten customers and the serving tier has to be
browsers running the extractor via `page.evaluate()` instead.

**Provenance, because this is a load-bearing input I have not verified:** those numbers come from
the marketing page at `docs.getsolari.com/pricing`, read through a summarising fetch tool — a
published tier table, *second-hand*, describing hypothetical plans. **They are not our account's
caps, and I have never observed a limit from our key.** A published table can be stale, can be
rounded for marketing, and says nothing about what our specific key is provisioned for. Until the
capacity half of the spike returns real numbers, **every conclusion in this paragraph is an
assumption, and the "finishable" and "Solari-nativeness" scores that lean on it are soft.**

**Honest reason it gets zero users.** The category is crowded and the incumbents have free tiers.
A first-run extractor that returns three of five fields correctly reads as broken, and the user
leaves before the self-healing — the actual differentiator — has ever had a chance to fire. The
best feature is invisible on day one.

---

## B — Geogrid: see any page as it renders from N cities at once

Paste a URL. Twelve stealth browsers on residential IPs in twelve named cities load it
simultaneously; you get a grid of screenshots, the resolved egress for each, and the diffs between
them. Suggested directly by §8b: the SDK's `ProxyRequest` exposes `state`, `city` and `asn`
targeting that no docs page mentions.

**Who specifically wants this.** An SEO or ad-ops person verifying that a geo-targeted campaign,
localized price, or regional rollout actually renders where it should; a developer debugging a
geo-block or CDN mis-route; a founder checking a launch is live in every market. Today they do it
with a consumer VPN and manual screenshots, ask a colleague in another country over Slack, or pay
BrightData / Semrush.

**Solari primitives required.** Stealth (mandatory — proxy requires it) · managed residential proxy
with **city/state/ASN targeting** · 12 concurrent browsers · screenshots · session recording for
the replay link.

**What breaks without Solari.** Everything, immediately. You cannot obtain a residential IP in Los
Angeles, Frankfurt and São Paulo from a laptop. The substitute is a proxy-vendor contract with a
four-figure minimum, plus twelve concurrent headful browsers with matching timezones and
fingerprints. This is the cleanest "impossible locally" of the three by a distance.

**Honest reason it gets zero users.** It is a checker, not a workflow. Most people need this once,
resolve their question, and never return — and the ones who need it daily already pay for a tool
that does it inside their existing dashboard. High click-through, low retention. A tool that 300
people try once and nobody uses twice is not obviously a win under the stated criterion.

---

## C — Sentinel: watch pages that have no API, including logged-in and bot-protected ones

Give it a URL and what to watch. It checks on a schedule from a real browser, tells you when the
thing changes, and shows you the DOM-level replay of the check that caught it. The wedge is the
half existing tools cannot reach: pages behind a login, behind Cloudflare, or that render
differently by region.

**Who specifically wants this.** Someone tracking a restock, a price, a competitor's changelog, a
permit or docket portal, a supplier's stock page, a status dashboard with no RSS. Today they use
changedetection.io or Visualping — both of which fail exactly on the pages that matter, because
those pages need a login or throw a bot challenge — or they check manually, badly, forever.

**Solari primitives required.** Profiles (log in once, reuse forever) · stealth + captcha (get past
the challenge) · proxy (region-gated pages) · recording (rrweb NDJSON is *diffable*, so "what
changed" is a data operation, not a screenshot comparison) · one browser per check, which fits
inside any plan tier.

**What breaks without Solari.** A cron plus Playwright on a VPS covers roughly 70% of this. The
remaining 30% — a durable server-side logged-in profile, captcha solving, residential egress — is
where every free competitor is broken today, and is precisely what Solari sells. So the
differentiation is real but partial.

**Honest reason it gets zero users.** Setup friction is the killer: choose a page, express what to
watch, and — for the differentiating case — hand over a login to a stranger's website. That last
step is a wall most visitors will not climb, and it makes the no-signup public demo impossible for
the exact feature that makes the product worth building.

---

## Scores

1–5, higher is better. Scored against the ~35-hour assumption above.

| | **A** Scraper API | **B** Geogrid | **C** Sentinel |
| --- | :---: | :---: | :---: |
| Market pull | 4 | 3 | 4 |
| Solari-nativeness | 5 | 5 | 4 |
| Demoable in 90 seconds | 3 | 5 | 4 |
| Finishable in budget | 2 | 5 | 4 |
| **Total** | **14** | **18** | **16** |

Where the low scores come from. **A/finishable = 2**: LLM codegen, sandboxed validation,
scheduling, serving, *and* healing is four products; the healing loop alone is the whole budget.
**A/demoable = 3**: the payoff is a JSON body, and the one cinematic moment requires staging a site
change. **B/market pull = 3**: narrow and non-recurring, see its zero-users paragraph.
**C/nativeness = 4**: a VPS cron reaches most of it. **B/finishable = 5**: fan out, screenshot,
render a grid — genuinely small, which leaves Phase 3 and 4 fully funded.

---

## Recommendation: B, Geogrid

Three reasons, in order of weight.

1. **It is the only candidate whose core is arithmetically impossible without Solari.** A judge who
   built this platform can see in one screen that city-level residential egress across twelve
   concurrent stealth browsers is their product and nobody else's. A and C both have a "you could
   mostly do this with a VPS" rebuttal; B does not.
2. **It is the only one that certainly ships *and* gets distributed.** The criterion is people
   using the build. Phase 4 — deploy, README, video, MCP, cookbook PR, seeding communities — is
   where users come from, and it needs ~12 of 35 hours. B is the only candidate that leaves that
   budget intact.
3. **The artifact is the marketing.** A grid of twelve screenshots of a page that renders
   differently in Frankfurt than in Chicago is a thing people forward. A JSON endpoint is not.

## The strongest case against my own recommendation

**B is a feature, not a product, and the criterion is retention.**

"Get people to use your build" is not "get people to click your build." A geo checker answers a
question once. The user resolves their curiosity, closes the tab, and never returns — so a
LinkedIn post might produce 300 visitors and three second-sessions. Meanwhile **C is recurring by
construction**: every user who creates a watch is, by definition, a returning user. If the judges
read "people actually use it" as sustained usage rather than trial volume, C wins on the only axis
that counts and my 18-vs-16 is measuring the wrong thing.

There is a second, sharper objection. **B's capacity envelope may not exist.** Proxy *requires*
stealth, so all twelve of B's browsers are stealth browsers, and stealth is provisioned as its own
much smaller pool. A twelve-way fan-out may be asking for more concurrent stealth capacity than
either our plan or the platform will give at that moment. If so, B's central interaction is slow,
partial, or `NoCapacityError`, and the demo dies on stage.

**Where I land: still B — but conditionally, and the condition is the spike below.**

The retention objection is real and I am not dismissing it; I am answering it with scope. B's
grid is a one-shot artifact, but *saving a grid and re-running it on a schedule* is roughly a day
of work on top, and it converts the one-shot checker into C's recurring mechanic without inheriting
C's login-friction problem. That is the narrowest version that is still genuinely useful: **ship
the one-shot grid first, add "watch this grid" second.** If I had to defend one sentence to the
judges it is that B is the only idea here where their platform is not a convenience but the entire
reason the thing can exist — and that is worth more than C's structurally better retention curve,
*provided* the capacity holds.

If the spike says it does not hold, B is dead as specified and we re-pick, most likely to C.

---

## Reopening condition for candidate A — pre-committed

A's architecture was ruled out on one number: concurrent sandboxes at **1 / 2 / 10**, taken from a
marketing tier table, never observed from our key. That number is the entire basis for "a
sandbox-per-served-API dies at ten customers", which is what pushed A's serving tier onto browsers
and cost it points.

Recorded here so it cannot be quietly skipped once `spike-capacity.ts` runs:

> **If the observed concurrent sandbox cap is ≥ 20, candidate A returns to the table and this
> document is re-scored before any further work.** At ≥ 20, sandbox-per-API is viable for a launch
> cohort, the "generation and validation only" workaround becomes unnecessary, and A's
> Solari-nativeness argument gets materially stronger than it reads above.
>
> Between **10 and 19**, A is not reopened but the architecture note above is corrected rather than
> left standing as though it were measured.
>
> Below **10**, the original reasoning holds and A stays where it is.

The same applies in reverse to B: if the observed **browser** cap is below 6, B's twelve-tile grid
cannot exist as designed on this account regardless of what fidelity says.

---

## The single assumption that kills B if false

> **Twelve concurrent stealth sessions with per-city residential proxies can actually be held at
> once, and each one really egresses from the city it was asked for.**

Two ways it fails, both fatal:
- **Capacity** — the warm stealth pool is ~8 platform-wide; twelve concurrent stealth launches may
  return `ConcurrencyLimitExceeded` (our plan cap) or `NoCapacityError` (Solari's pool). Either way
  a twelve-city grid cannot be filled.
- **Fidelity** — `city` and `state` are undocumented fields found only in the `.d.ts`. If they are
  silently ignored, or if requests degrade to a country-level IP the way `tier: "mobile"` is
  documented to degrade to residential, then the grid is twelve screenshots of the same place and
  the product is a lie.

The spike is `scripts/spike-geogrid.ts`. It launches N stealth+proxy sessions concurrently, asks a
geolocation endpoint what city each one actually came from, and prints requested-vs-actual with
timings and named errors. Result recorded below once run.

### Spike result — PARTIAL. The decisive half is blocked.

`[RUN]` 2026-09-04, `npm run spike`. The free warm-pool pre-check ran; the keyed half refused to
start because `SOLARI_API_KEY` was not set, and reported so rather than proceeding.

**What this did establish.** Warm stealth capacity on the day of the run had headroom for a
twelve-way fan-out, and — comparing against a sample taken the day before — **it moves a lot**. An
earlier draft of this document built the capacity objection on a single low reading and treated it
as a platform ceiling. That was a reasoning error: one sample is a snapshot. The right response is
not a better guess but a **pre-flight size check at request time**, which is free and needs no key.
(Actual readings are not reproduced here; see the private disclosure note.)

**What this did not establish, and they are the two things that matter.** Nothing has been shown
about (a) whether *our account* permits twelve concurrent stealth sessions — platform warmth says
nothing about our own `ConcurrencyLimitExceeded` cap — or (b) whether `city`/`state` targeting does
anything at all. Fidelity is completely untested, and it is the half that decides whether the
product is real or a lie.

**Status: the spike has not passed.** `PLAN.md` is deliberately not written. One command finishes
this the moment a key exists:

```bash
printf 'SOLARI_API_KEY=slr_live_...\n' > .env && cd scripts && npm run spike
```

Run `npm run spike -- --serial` as the follow-up: serial execution isolates fidelity from capacity,
so if the concurrent run fails we learn which of the two failed.
