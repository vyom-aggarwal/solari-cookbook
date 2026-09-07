# Spike: Geogrid — pre-registered pass bar

**Committed before the spike is run with a key.** The point of writing thresholds down first is
that a marginal result cannot be talked into a pass afterwards. If the numbers land between the
bars, the verdict is AMBIGUOUS, and AMBIGUOUS is not a pass.

Nothing in this file may be edited after the first keyed run. Results go in a separate
`## Results` section appended at the bottom, and any disagreement with the bar gets argued in prose
there — not by moving a number up here.

---

## The assumption under test

> **N concurrent stealth sessions with per-city residential proxies can be held at once, and each
> one really egresses from the city it was asked for.**

Two halves, run in isolation so a failure is attributable:

- **CAPACITY** — can we hold twelve at once, against *our* account.
- **FIDELITY** — does `city` / `state` targeting actually do anything.

Fidelity is the half that decides whether the product is real. Capacity only decides how wide the
grid can be.

---

## Measurement design

### Geolocation providers

City-level geo-IP disagrees between providers constantly, so a single provider proves nothing. Two
independent ones, both queried **from inside the proxied session** so they see the egress IP:

| Provider | Transport | Fields used |
| --- | --- | --- |
| `ipwho.is` | HTTPS, keyless | `city`, `region`, `latitude`, `longitude`, `connection.asn`, `connection.org`, `connection.isp` |
| `ip-api.com` | HTTP, keyless | `city`, `regionName`, `lat`, `lon`, `as`, `asname`, `isp`, `org`, **`hosting`**, **`mobile`**, **`proxy`** |

`ipapi.co` was evaluated and **rejected**: it returned `{"reason":"RateLimited"}` on the first
unauthenticated request from a residential connection, so it cannot be relied on for a 15-request
run.

`ip-api.com` is HTTP-only on its free tier. Accepted deliberately — it is the only keyless source
of a `hosting` boolean, which control (c) needs — and its verdicts are treated as corroboration,
never as the sole basis for a pass.

### The noise floor, measured before setting the bar

Queried both providers for one residential AT&T IP, from this machine, before writing these
thresholds:

- `ipwho.is` → **Stockton, California**, AS7018
- `ip-api.com` → **Lathrop, California**, AS7018

Same ASN, same ISP, same metro, **two different city names about 15 km apart.** That is the
baseline disagreement between these providers on an easy case.

**Consequence, and this is why the bar is written the way it is:** exact string matching on city
names would fail a perfectly good result. Accuracy is therefore scored by **great-circle distance
from the requested city's reference coordinates**, not by name equality. Names are still recorded
verbatim in the results table so the raw disagreement stays visible.

### Reference coordinates

| Target | Lat | Lon |
| --- | --- | --- |
| `los_angeles`, california | 34.0522 | −118.2437 |
| `chicago`, illinois | 41.8781 | −87.6298 |
| `new_york`, new_york | 40.7128 | −74.0060 |
| `dallas`, texas | 32.7767 | −96.7970 |

Country-level targets (`de`, `jp`) are scored on ISO country code match only.

### Run plan

- **Capacity:** one batch, 12 concurrent stealth sessions, no proxy variation needed.
- **Fidelity:** 4 US cities × 3 runs = 12 sessions, plus **6 country-only US runs (the F6 control
  arm)**, plus 2 international country targets, plus 1 bogus-city control = **21 sessions, run
  serially** so that a capacity failure cannot be mistaken for a fidelity failure.
- Estimated cost: ~33 stealth sessions alive ~20 s each, fetching ~2 KB of JSON per session.
  Under **$0.08** total at any plan rate.

---

## CAPACITY — thresholds

First, three facts to record (not pass/fail — these replace the unverified marketing figures that
section 6 of the notes currently leans on):

- plan tier on our key
- observed concurrent **browser** cap, and observed concurrent **sandbox** cap
- credit balance
- `expiresAt` delta on a fresh session, i.e. our real `plan.maxSessionMinutes`

Then the bar:

| Verdict | Condition |
| --- | --- |
| **PASS** | ≥ 12 concurrent stealth sessions held simultaneously, zero `ConcurrencyLimitExceeded`, zero `NoCapacityError` |
| **CONDITIONAL** | 6–11 held. The grid ships narrower than twelve; the product still works |
| **FAIL** | < 6 held |

Also recorded: **which** error appears at the ceiling. `ConcurrencyLimitExceeded` means our plan is
the limit and money fixes it. `NoCapacityError` means Solari's pool is the limit and money does
not. These have very different implications and must not be collapsed.

---

## FIDELITY — thresholds

Let a **HIT** mean: `min(distance(providerA, target), distance(providerB, target)) ≤ 100 km`.
Let a **NEAR** mean the same quantity is ≤ 250 km.

| ID | Control | Metric | PASS threshold |
| --- | --- | --- | --- |
| **F1** | Accuracy | HIT rate across the 12 US city runs | **≥ 70%** |
| **F2** | Stability *(control a)* | Per city, ≥ 2 of 3 runs are HITs | **≥ 3 of the 4 cities** |
| **F3** | Distinctness *(control b)* | Unique egress IPs; and **no single IP serving two different requested cities** | **≥ 90% unique, and zero cross-city reuse** |
| **F4** | Residential *(control c)* | **ASN organisation name** classified consumer-ISP vs hosting; `hosting` boolean secondary | **≥ 70% classified residential by org** |
| **F5** | Inertness *(control d)* | `city: "nowhereville", state: "nowhere", country: "us"` | see below |
| **F6** | **Counterfactual** | City-targeted distance vs **country-only** distance to the same centroid | **≥ 3 of 4 cities at ≤ 0.4×**. **Fatal on its own** |

**F5 in full.** Request a city that does not exist and record which happens:

- *Errors* → the parameter is validated. Good. F5 passes.
- *Silently succeeds* → the parameter is at least partly advisory. This is **fatal only in
  combination**: F5 fails if bogus-city succeeds **and** F1 < 70%. That pairing is the signature of
  an inert parameter — the `webBotAuth` failure mode, where an option is accepted and ignored. If
  F1 is strong, silent fallback to country level is acceptable behaviour that we document rather
  than a defect.

**Why 70% and not 90% on F1.** Residential proxy pools do not have inventory in every city at
every moment; a request that cannot be filled in Dallas legitimately falls back to somewhere else
in Texas or the US. 70% is the level at which a twelve-tile grid shows genuinely different places
rather than the same place twelve times, which is the product claim. Below that, the grid is
decoration.

**Why F4 matters most after F1.** A datacenter IP wearing a city label makes Geogrid
indistinguishable from twelve VPSes, and removes the only moat the product has. If F4 fails while
F1 passes, the product is *technically* accurate and *strategically* dead, and the recommendation
should flip regardless of the other numbers.

**F4 scoring, revised — org name primary, boolean secondary.** `ip-api.com`'s `hosting` flag is
unreliable in both directions: it misses hosting ranges that resell as "business broadband" and it
sometimes flags carrier-grade NAT on real consumer ISPs. The fact that actually decides this is the
**ASN organisation name**. A consumer ISP (Comcast, Verizon, AT&T, Deutsche Telekom, Orange, Jio,
KDDI…) means residential egress. A hosting org (AWS, Google, Hetzner, OVH, DigitalOcean, M247,
Leaseweb, Vultr…) means twelve VPSes in a trenchcoat. Scoring:

- **Primary:** classify each egress IP's ASN org against a pre-registered keyword list, below.
- **Secondary, reported but not scored:** `ip-api.com`'s `hosting` and `mobile` booleans, shown
  beside the org so any disagreement between the two signals is visible.
- **Every org string is reported verbatim, per run.** The classifier is a heuristic and its job is
  to summarise, not to be believed — the raw strings are in the results table so they can be judged
  directly.
- If **more than 30% of orgs are unclassified**, F4 is **AMBIGUOUS**, not a pass, and the verbatim
  strings decide.

Pre-registered keyword lists (substring, case-insensitive):

- **Hosting:** `amazon`, `aws`, `google`, `microsoft`, `azure`, `digitalocean`, `ovh`, `hetzner`,
  `linode`, `vultr`, `contabo`, `leaseweb`, `m247`, `datacamp`, `choopa`, `scaleway`, `oracle`,
  `alibaba`, `tencent`, `equinix`, `colo`, `hosting`, `datacenter`, `data center`, `dedicated`,
  `vps`, `cloud`, `server`
- **Consumer ISP:** `comcast`, `verizon`, `at&t`, `att `, `spectrum`, `charter`, `cox`,
  `centurylink`, `frontier`, `t-mobile`, `sprint`, `vodafone`, `telekom`, `orange`, `bt `, `sky `,
  `virgin`, `telefonica`, `movistar`, `kddi`, `ntt`, `softbank`, `telstra`, `optus`, `rogers`,
  `bell`, `videotron`, `sfr`, `bouygues`, `free sas`, `jio`, `airtel`, `claro`, `vivo`, `tim `,
  `telus`, `shaw`, `windstream`, `mediacom`, `cable`, `broadband`, `telecom`, `communications`

---

## F6 — the counterfactual, added before any keyed run

**The gap this closes.** F1 at 70% within 100 km has two possible explanations and the bar as
originally written could not tell them apart. Either city targeting works, **or** the US
residential pool happens to be concentrated in exactly the large metros we picked, and we would
have landed near Los Angeles and Chicago by asking for nothing at all. The second explanation makes
the parameter decorative and the product a lie, and F1 would still read as a pass.

**The measurement.** Alongside the city-targeted runs, issue **6 matched requests specifying
`{country: "us"}` only** — no `city`, no `state`. Then, for each of the four target cities, compare:

- `median_city` — median distance from that city's centroid across its 3 city-targeted runs
- `median_country` — median distance from **that same centroid** across all 6 country-only runs

**Threshold.** For each city, the city-targeted runs must be **at least 2.5× closer**:
`median_city ≤ 0.4 × median_country`. **F6 passes only if this holds for ≥ 3 of the 4 cities.**

**F6 is fatal on its own.** If it fails, B is dead regardless of F1–F5, and no combination of the
other numbers rescues it.

**Why 0.4 and not something stricter.** A random US residential IP sits on the order of 1,500–2,000
km from any given city centroid, so genuine city targeting should produce a 15×–20× improvement,
not 2.5×. The bar is set well below the expected effect deliberately: it is there to catch
*decoration*, not to demand perfection from a proxy pool with uneven city inventory.

**Degenerate case, pre-registered so it isn't argued later.** If `median_country` for a city is
already **< 200 km**, the pool is concentrated there anyway and the ratio test is meaningless for
that city. Such a city is **excluded from the F6 count and reported as INCONCLUSIVE**. If that
leaves fewer than 3 scorable cities, **F6 is AMBIGUOUS**, which does not authorise `PLAN.md`.

---

## Overall verdict

| Verdict | Condition |
| --- | --- |
| **PASS** | CAPACITY is PASS or CONDITIONAL, **and** F1–F4 all pass, **and** F5 is not fatal, **and F6 passes** |
| **AMBIGUOUS** | Any fidelity metric lands within **10 percentage points below** its threshold, or F4/F6 return AMBIGUOUS by their own rules |
| **FAIL** | Anything else, **or F6 fails on its own** |

**`PLAN.md` is written only on PASS.** On AMBIGUOUS or FAIL the numbers come back to the repo owner
and we re-pick — most likely to candidate C.

---

## Results

*(empty — appended after the first keyed run)*
