/**
 * An AI provider call failed. `message` is what the reader sees: a plain-English reason (when the failure
 * is recognisable) followed by the provider's own words, e.g.
 * `Out of tokens / rate limited — LiteLLM (openai) said: "You've reached your usage limit."`
 */
export class AiError extends Error {
  /** Plain-English reason; null when the failure isn't one we recognise (the provider message stands alone). */
  readonly reason: string | null;

  constructor(reason: string | null, providerMessage: string, source: string, options?: ErrorOptions) {
    super(`${reason ? `${reason} — ` : ""}${source} said: "${providerMessage}"`, options);
    this.name = "AiError";
    this.reason = reason;
  }
}

/**
 * An AI call was stopped by our limits: no data for too long, or still running at the hard cap. A brief that hits
 * this stops making AI calls altogether (a stalled or runaway provider would only burn more tokens).
 */
export class AiTimeoutError extends AiError {
  constructor(providerMessage: string, source: string) {
    super("The AI provider took too long", providerMessage, source);
    this.name = "AiTimeoutError";
  }
}

const QUOTA = /rate.?limit|quota|usage.?limit|too many requests|insufficient|credit|exhausted/i;
const UNREACHABLE = /APIConnection|TimeoutError|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed|socket hang up/i;

const field = (e: unknown, key: string): unknown => (typeof e === "object" && e !== null && key in e ? (e as Record<string, unknown>)[key] : undefined);

/** The provider's own message: the SDKs keep the response body in `.error`; their `.message` is prefixed with the status. */
function providerText(e: unknown): string {
  const body = field(e, "error");
  const inner = field(body, "message") ?? field(field(body, "error"), "message");
  const text = typeof inner === "string" && inner ? inner : e instanceof Error ? e.message.replace(/^\d{3}\s+/, "") : String(e);
  return text.trim().slice(0, 400) || "No details given";
}

export function toAiError(e: unknown, source: string): AiError {
  if (e instanceof AiError) return e;
  const status = field(e, "status");
  const text = providerText(e);
  const name = e instanceof Error ? `${e.name} ${e.constructor.name} ${e.message} ${String(field(e, "cause") ?? "")}` : "";
  const reason =
    status === 429 || QUOTA.test(text)
      ? "Out of tokens / rate limited"
      : status === 401 || status === 403
        ? "Sign-in to the provider failed (check Settings → AI)"
        : UNREACHABLE.test(name)
          ? "Can't reach the AI provider"
          : null;
  return new AiError(reason, text, source, { cause: e });
}
