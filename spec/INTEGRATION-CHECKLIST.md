# Aurum Integration Checklist

Status: FROZEN

## Before merge

- Worker base SHA matches the TL-issued dependency SHA.
- Changed files are within work-item ownership.
- Contract requests are recorded rather than hidden shared edits.
- No duplicate state owner was introduced.
- No provider SDK crossed a domain boundary.
- No new semantic database/router/policy engine appeared.
- Lab cannot execute.
- UI remains projection-only.

## Required verification

~~~bash
node scripts/check-workspace-freshness.mjs
pnpm fmt:check
pnpm lint
pnpm typecheck
pnpm architecture:check -- --changed
~~~

Run all actual target-package tests.

## Merge sequence

worker branch
 -> changed-file inspection
 -> contract inspection
 -> tests
 -> architecture gate
 -> merge
 -> root verification
 -> record exact integration SHA
 -> update CURRENT-STATE

## Evidence

Record:
work item, branch, base SHA, delivery SHA, merged SHA, tests and outputs, architecture result, security/tenant checks, live/fixture status, browser/E2E evidence and known limitations.

## Release

A release requires:
exact integrated SHA + exact deployment revision + certification result.
