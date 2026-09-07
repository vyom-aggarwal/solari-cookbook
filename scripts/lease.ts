/**
 * Minimal lease helper: nothing acquires a Solari resource except through here.
 *
 * Two things are non-negotiable and both are easy to get wrong:
 *   1. release on the error path as well as the success path
 *   2. a hard TTL, because `timeoutMs` on a sandbox is a ROLLING IDLE window —
 *      a machine that stays busy never times out on its own and bills forever
 *
 * This is the Phase 0 version, sized for the bench scripts. Phase 2 promotes it
 * into the service (job ids, structured logs, a reaper) — the contract stays.
 */
import { Solari, SolariError as BrowserError } from "@solarisdk/browser"
import type { BrowserSession, LaunchOptions } from "@solarisdk/browser"
import { SolariClient } from "@solarisdk/sdk"
import {
  ActionError,
  AuthError,
  ConcurrencyLimitError,
  ConnectionError,
  GatewayError,
  NoCapacityError,
  PlanError,
  TimeoutError,
} from "@solarisdk/core"
import type { CreateSandboxOptions } from "@solarisdk/core"
import type { Sandbox } from "@solarisdk/core"

/** Everything we tag, so the reaper can find our leaks and only ours. */
export const OWNER_TAG = { app: "solari-phase0" } as const

export type Failure = {
  kind:
    | "auth"
    | "plan"
    | "concurrency"
    | "no-capacity"
    | "credit"
    | "gateway"
    | "action"
    | "connection"
    | "timeout"
    | "unknown"
  /** What we would show a user. No stack traces, no vendor jargon. */
  message: string
  retryable: boolean
  status?: number
  code?: string
}

/**
 * The two SDK families each export their OWN `SolariError` class, from
 * different packages, with different shapes — `instanceof` does not cross the
 * boundary. So classify on both, and fall back to the wire fields.
 */
export function classify(err: unknown): Failure {
  if (err instanceof AuthError) {
    return { kind: "auth", retryable: false, status: err.status, code: err.code,
      message: "That API key was rejected. Check it at console.getsolari.com." }
  }
  if (err instanceof PlanError) {
    return { kind: "plan", retryable: false, status: err.status, code: err.code,
      message: "Your Solari plan does not include this feature (stealth, proxy and captcha need Starter or above)." }
  }
  if (err instanceof ConcurrencyLimitError) {
    return { kind: "concurrency", retryable: false, status: err.status, code: err.code,
      message: "You are at your concurrent-session cap. Nothing to retry — a running session has to finish first." }
  }
  if (err instanceof NoCapacityError) {
    return { kind: "no-capacity", retryable: true, status: err.status, code: err.code,
      message: "Solari has no warm host right now. Queued — this usually clears in seconds." }
  }
  if (err instanceof ActionError) {
    return { kind: "action", retryable: false, code: err.code,
      message: `The remote machine refused "${err.method}".` }
  }
  if (err instanceof TimeoutError) {
    return { kind: "timeout", retryable: true,
      message: `"${err.method}" got no reply within ${err.timeoutMs} ms.` }
  }
  if (err instanceof ConnectionError) {
    return { kind: "connection", retryable: true,
      message: "Lost the control channel to the machine." }
  }
  if (err instanceof GatewayError) {
    return fromWire(err.status, err.code, err.body?.retryable)
  }
  // The browser package's own error type — separate class, same job.
  if (err instanceof BrowserError) {
    return fromWire(err.status, err.code, undefined)
  }
  return {
    kind: "unknown",
    retryable: false,
    message: err instanceof Error ? err.message : String(err),
  }
}

function fromWire(status?: number, code?: string, retryable?: boolean): Failure {
  const base = { status, code }
  switch (code) {
    case "FeatureRequiresPlan":
      return { ...base, kind: "plan", retryable: false,
        message: "Your Solari plan does not include this feature." }
    case "ConcurrencyLimitExceeded":
      return { ...base, kind: "concurrency", retryable: false,
        message: "At your concurrent-session cap." }
    case "PlanLimitExceeded":
      return { ...base, kind: "plan", retryable: false,
        message: "You have hit a plan limit (profiles)." }
    case "InsufficientCredit":
      return { ...base, kind: "credit", retryable: false,
        message: "The Solari account is out of credit." }
    case "NotEntitled":
      return { ...base, kind: "plan", retryable: false,
        message: "This plan cannot create sandboxes or desktops." }
    case "BrowserUnhealthy":
      return { ...base, kind: "gateway", retryable: true,
        message: "Solari handed back an unhealthy browser. Retrying." }
    case "InvalidSessionId":
      return { ...base, kind: "gateway", retryable: false,
        message: "That session id is not one of ours." }
  }
  if (status === 401) return { ...base, kind: "auth", retryable: false, message: "API key rejected." }
  // Never retry a 4xx. 429 here means "at your cap", not "slow down".
  const transient = retryable ?? (status !== undefined && status >= 500 && status !== 501)
  return { ...base, kind: "gateway", retryable: transient,
    message: transient ? "Solari had a transient failure. Retrying." : `Solari refused the request (HTTP ${status ?? "?"}).` }
}

/** Reject if `work` outlives `ttlMs`, so `finally` still runs and still releases. */
async function withDeadline<T>(ttlMs: number, label: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`lease TTL ${ttlMs}ms exceeded for ${label}`)), ttlMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function withBrowser<T>(
  client: Solari,
  opts: LaunchOptions,
  ttlMs: number,
  fn: (browser: BrowserSession) => Promise<T>,
): Promise<T> {
  const browser = await client.launch(opts)
  try {
    return await withDeadline(ttlMs, `browser ${browser.id}`, fn(browser))
  } finally {
    // close() releases the session as well as the connection.
    await browser.close().catch(() => {})
  }
}

export async function withSandbox<T>(
  client: SolariClient,
  opts: CreateSandboxOptions,
  ttlMs: number,
  fn: (sandbox: Sandbox) => Promise<T>,
): Promise<T> {
  const sandbox = await client.sandboxes.create({
    ...opts,
    metadata: { ...OWNER_TAG, ...(opts.metadata ?? {}) },
  })
  try {
    return await withDeadline(ttlMs, `sandbox ${sandbox.sandboxId}`, fn(sandbox))
  } finally {
    // kill() destroys the VM. close() would only drop the local channel and
    // leave it billing until the idle timeout.
    await sandbox.kill().catch(() => {})
  }
}

/** Kill anything tagged as ours that is still alive. Safe to run on boot. */
export async function reap(client: SolariClient): Promise<string[]> {
  const killed: string[] = []
  for await (const s of client.sandboxes.listAll({ metadata: OWNER_TAG })) {
    if (s.state === "gone" || s.state === "archived") continue
    await client.sandboxes.kill(s.sandboxId).catch(() => {})
    killed.push(s.sandboxId)
  }
  return killed
}
