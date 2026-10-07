/**
 * Unanchored credential-pattern sanitization.
 *
 * Every free-text surface in the Provider Fabric (labels, descriptions,
 * endpoint URLs, evidence details, error text recorded from adapters) passes
 * through `sanitizeFreeText` before it is stored or re-emitted. The patterns
 * are deliberately UNANCHORED: a credential embedded mid-sentence, inside a
 * URL, inside JSON, or glued to punctuation is still redacted. The sanitizer
 * errs on the side of redaction — ordinary identifiers (ids, model keys) do
 * not match because every pattern requires a credential SHAPE (known token
 * prefix, key-name cue, or URL userinfo position), not mere length.
 *
 * Sanitization is idempotent: applying it to its own output is a no-op, so
 * write-time guards can safely re-check stored text.
 */

export const REDACTED = "[REDACTED]";

interface SanitizationPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replace: (match: RegExpExecArray) => string;
}

/** Rebuilds a pattern as a fresh, non-global regex (detection is stateless). */
function detectionClone(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace("g", ""));
}

const CREDENTIAL_PATTERNS: readonly SanitizationPattern[] = [
  // URL user:password userinfo — scheme://user:secret@host (unanchored, mid-URL)
  {
    name: "url-userinfo",
    pattern: /(\w[\w+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/g,
    replace: (m) => `${m[1] ?? ""}${REDACTED}@`,
  },
  // Private key blocks (PEM etc.), including multi-line bodies
  {
    name: "private-key-block",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: () => `[REDACTED PRIVATE KEY]`,
  },
  // Authorization header / prose forms: "Bearer <token>", "Basic <b64>"
  {
    name: "authorization-scheme",
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replace: (m) => `${m[1] ?? ""} ${REDACTED}`,
  },
  // Anthropic keys (sk-ant-..., sk-ant-api03-...) — MUST precede the generic
  // OpenAI pattern, which would otherwise swallow the ant- prefix.
  {
    name: "anthropic-key",
    pattern: /\bsk-ant-(?:api\d*-)?[A-Za-z0-9_-]{16,}\b/g,
    replace: () => `sk-ant-${REDACTED}`,
  },
  // OpenAI-style keys (sk-..., sk-proj-...)
  {
    name: "openai-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
    replace: () => `sk-${REDACTED}`,
  },
  // GitHub tokens
  {
    name: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    replace: () => `ghp_${REDACTED}`,
  },
  {
    name: "github-pat",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replace: () => `github_pat_${REDACTED}`,
  },
  // AWS access key ids
  {
    name: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => `AKIA${REDACTED}`,
  },
  // Google API keys
  {
    name: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    replace: () => `AIza${REDACTED}`,
  },
  // Slack tokens
  {
    name: "slack-token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => `xox-${REDACTED}`,
  },
  // Key/value credential assignments in prose, query strings, headers, JSON:
  //   api_key=...   "apiKey": '...'   password: value   secret => value
  // The lookahead suppresses re-matching our own [REDACTED] output so the
  // pass is idempotent; brackets are excluded from bare values for the same
  // reason.
  {
    name: "credential-assignment",
    pattern:
      /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|client[_-]?secret|secret|password|passwd|pwd|token)\b(\s*(?::|=|=>|->)\s*|\s*["']\s*:\s*["'])(?!\[REDACTED\]["']?)(?:"([^"\n]{8,})"|'([^'\n]{8,})'|([^\s,"';&<>[\]]{8,}))/gi,
    replace: (m) => {
      const key = m[1] ?? "";
      const separator = m[2] ?? "";
      const quoted = m[3] !== undefined || m[4] !== undefined;
      return `${key}${separator}${quoted ? `"${REDACTED}"` : REDACTED}`;
    },
  },
  // Explicit credential headers: x-api-key: <value>, x-auth-token <value>
  {
    name: "credential-header",
    pattern: /\b(x-api-key|x-auth-token|x-amz-security-token)\b[":\s]+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (m) => `${m[1] ?? ""}: ${REDACTED}`,
  },
];

/**
 * Redacts credential-shaped substrings from free text. Unanchored by
 * construction: each pattern is a global regex without ^/$ anchors.
 */
export function sanitizeFreeText(input: string): string {
  let output = input;
  for (const { pattern, replace } of CREDENTIAL_PATTERNS) {
    output = output.replace(pattern, (...args: unknown[]) => {
      // replace-callback args: [match, ...groups, offset, subject]
      const match = args.slice(0, args.length - 2) as unknown as RegExpExecArray;
      return replace(match);
    });
  }
  return output;
}

/**
 * True when the text contains credential-shaped material. Used by tests and
 * by write-time guards; safe to call repeatedly (no shared regex state).
 */
export function containsCredentialMaterial(input: string): boolean {
  return CREDENTIAL_PATTERNS.some(({ pattern }) => {
    const probe = detectionClone(pattern);
    probe.lastIndex = 0;
    return probe.test(input);
  });
}

/**
 * Guard used on every free-text write surface: sanitize, then verify the
 * result is clean. If a pattern interaction still leaves credential-shaped
 * text, redact the whole surface rather than risk leakage.
 */
export function sanitizeAndAssertClean(input: string): string {
  const sanitized = sanitizeFreeText(input);
  return containsCredentialMaterial(sanitized) ? REDACTED : sanitized;
}
