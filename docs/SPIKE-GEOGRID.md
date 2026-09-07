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
- **Fidelity:** 4 US cities × 3 runs = 12 sessions, plus 2 country targets, plus 1 bogus-city
  control = **15 sessions, run serially** so that a capacity failure cannot be mistaken for a
  fidelity failure.
- Estimated cost: ~27 stealth sessions alive ~20 s each, fetching ~2 KB of JSON per session.
  Under **$0.05** total at any plan rate.

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
| **F4** | Residential *(control c)* | `hosting == false` on `ip-api.com` | **≥ 70% of egress IPs** |
| **F5** | Inertness *(control d)* | `city: "nowhereville", state: "nowhere", country: "us"` | see below |

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

---

## Overall verdict

| Verdict | Condition |
| --- | --- |
| **PASS** | CAPACITY is PASS or CONDITIONAL, **and** F1–F4 all pass, **and** F5 is not fatal |
| **AMBIGUOUS** | Any fidelity metric lands within **10 percentage points below** its threshold |
| **FAIL** | Anything else |

**`PLAN.md` is written only on PASS.** On AMBIGUOUS or FAIL the numbers come back to the repo owner
and we re-pick — most likely to candidate C.

---

## Results

*(empty — appended after the first keyed run)*
