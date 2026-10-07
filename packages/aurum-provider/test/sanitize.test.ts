/**
 * ACCEPTANCE: unanchored credential-pattern sanitization, proven against
 * credentials embedded in URLs, prose notes and error text. The sanitizer
 * is the write-guard for every free-text surface in the fabric.
 */
import { describe, expect, it } from "vitest";
import { containsCredentialMaterial, sanitizeFreeText } from "../src/domain/sanitize.js";

describe("credential sanitizer", () => {
  it("redacts credentials embedded in URL userinfo (unanchored, mid-URL)", () => {
    const input = "https://tenant-user:SuperSecret123@api.example.com/v1/models";
    const output = sanitizeFreeText(input);
    expect(output).toBe("https://[REDACTED]@api.example.com/v1/models");
    expect(containsCredentialMaterial(output)).toBe(false);
  });

  it("redacts api keys in query strings", () => {
    const input = "https://api.example.com/v1/chat?api_key=abcdefgh12345678&x=1";
    const output = sanitizeFreeText(input);
    expect(output).toBe("https://api.example.com/v1/chat?api_key=[REDACTED]&x=1");
    expect(containsCredentialMaterial(output)).toBe(false);
  });

  it("redacts OpenAI-style keys embedded in prose notes", () => {
    const input = "note: customer insisted the key sk-abc123def456ghi789jkl works";
    const output = sanitizeFreeText(input);
    expect(output).toBe("note: customer insisted the key sk-[REDACTED] works");
    expect(containsCredentialMaterial(output)).toBe(false);
  });

  it("redacts Anthropic-style keys", () => {
    const input = "failed with sk-ant-api03-AbCdEf1234567890123456";
    const output = sanitizeFreeText(input);
    expect(output).toBe("failed with sk-ant-[REDACTED]");
    expect(containsCredentialMaterial(output)).toBe(false);
  });

  it("redacts bearer tokens in error text from adapters", () => {
    const input = "401 Unauthorized: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 rejected";
    const output = sanitizeFreeText(input);
    expect(output).toBe("401 Unauthorized: Bearer [REDACTED] rejected");
    expect(containsCredentialMaterial(output)).toBe(false);
  });

  it("redacts GitHub, AWS and Google tokens", () => {
    const ghp = sanitizeFreeText("token ghp_1234567890abcdefghijklmnopqrstuvwx");
    expect(ghp).toBe("token ghp_[REDACTED]");
    const aws = sanitizeFreeText("used AKIAIOSFODNN7EXAMPLE for s3");
    expect(aws).toBe("used AKIA[REDACTED] for s3");
    const google = sanitizeFreeText("key AIzaSyA1234567890abcdefghijklmnopqrstuv");
    expect(google).toBe("key AIza[REDACTED]");
  });

  it("redacts credential assignments in JSON-like and header forms", () => {
    const json = sanitizeFreeText('{"api_key": "secretvalue12345", "model": "x"}');
    expect(json).toBe('{"api_key": "[REDACTED]", "model": "x"}');
    const header = sanitizeFreeText("x-api-key: 0123456789abcdef");
    expect(header).toBe("x-api-key: [REDACTED]");
    const colon = sanitizeFreeText("password: hunter2secretvalue");
    expect(colon).toBe("password: [REDACTED]");
  });

  it("redacts private key blocks including their bodies", () => {
    const input =
      "config:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nmore\n-----END RSA PRIVATE KEY-----\nend";
    const output = sanitizeFreeText(input);
    expect(output).toBe("config:\n[REDACTED PRIVATE KEY]\nend");
  });

  it("is idempotent: sanitizing its own output changes nothing", () => {
    const inputs = [
      "https://u:SuperSecret123@api.example.com/v1",
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 failed",
      '{"api_key": "secretvalue12345"}',
      "sk-abc123def456ghi789jkl in prose",
    ];
    for (const input of inputs) {
      const once = sanitizeFreeText(input);
      expect(sanitizeFreeText(once)).toBe(once);
    }
  });

  it("preserves ordinary identifiers, model keys and prose", () => {
    const ordinary = [
      "claude-sonnet-4-5",
      "gpt-4o-mini",
      "task-1 and task-2",
      "provider definition provdef-3",
      "purpose cognition for tenant-a",
      "the model was unavailable",
      "http://127.0.0.1:11434/api/tags",
    ];
    for (const input of ordinary) {
      expect(sanitizeFreeText(input)).toBe(input);
      expect(containsCredentialMaterial(input)).toBe(false);
    }
  });

  it("detects credential material before sanitization", () => {
    expect(containsCredentialMaterial("plain text")).toBe(false);
    expect(containsCredentialMaterial("sk-abc123def456ghi789jkl")).toBe(true);
    expect(containsCredentialMaterial("https://u:p@host/")).toBe(true);
  });
});
