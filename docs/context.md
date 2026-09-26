# ULPF — Context Log (Current Status)

**Scope of this document:** the CURRENT phase only. Unlike the other docs, this file is not a reference — it is a running, dated log of what has actually been built, checked and verified in this repo. It exists so that any contributor, and any LLM agent resuming work, can know exactly what's real without re-reading every commit or guessing from the plan.

> **Rule: nothing goes in this file unless it has been actually built and its acceptance criteria (from `phases.md`) have actually passed.** A planned feature, an in-progress feature, or an assumption is NOT a status update — see `agent.md` Section "Anti-Hallucination Rules" for the exact discipline.

---

## Current Phase: **M2 — Integrity: Merkle, Ledger, Verification**

**Phase start date:** 2026-09-26
**Phase status:** Complete (Advancing to M3)

## What Exists Right Now

### Monorepo folder structure
Full monorepo tree created per README §4: `docs/`, `packages/contracts/`, `packs/`, `services/` (6 services), `tools/`, `keys/`, `tests/e2e/`, `docker/`.

### `packages/contracts` — JSON Schema + Generated Types
- **7 JSON Schemas** in `packages/contracts/schemas/`:
  `raw_ingest.v1`, `merkle_leaf.v1`, `extraction_envelope`, `review_queue.v1`, `pack_lifecycle.v1`, `ocsf_event.v1`, `error_response`
- **Python (Pydantic v2):** Generated models in `packages/contracts/python/ulpf_contracts/generated/` via `datamodel-code-generator`. Re-exported from `ulpf_contracts/__init__.py`.
- **TypeScript:** Generated interfaces in `packages/contracts/typescript/src/generated.ts` via `json-schema-to-typescript`. Barrel-exported from `src/index.ts`. Built to `dist/`.
- **Codegen scripts:** `packages/contracts/python/scripts/generate.py` and `packages/contracts/typescript/scripts/generate.mjs`.

### DB Schema (SQLite)
- All 8 tables from `architecture.md` §4 implemented in `packages/contracts/python/ulpf_contracts/db_schema.py` and `services/review-api/src/db.ts` / `services/ingestion-svc/src/db.ts`.
- Tables: `raw_events`, `merkle_chunks`, `extraction_history`, `normalization_history`, `review_queue`, `mapping_packs`, `pack_lifecycle_events`, `test_fixtures`, plus `_schema_version`.
- WAL mode, foreign keys, CHECK constraints, MVP type mappings (UUID→TEXT, JSONB→JSON, BIGSERIAL→INTEGER AUTOINCREMENT).

### `ingestion-svc` (M1 Complete)
- **Listeners:** Syslog UDP (RFC 3164/5424), TCP (octet-counting & newline delimited), and HTTP (`POST /ingest`).
- **Envelope generator:** Generates UUIDv4 `lineage_id`, 64-character lowercase SHA-256 content seal, ISO-8601 UTC microsecond timestamp, and non-destructive character encoding detector.
- **Raw Store:** Filesystem chunk store with `zstd-codec` frame compression and `.idx.json` offset indexing. Bit-for-bit raw byte recovery verified.
- **Dual-Trigger Batcher:** Flushes on count trigger (`maxEventCount`) or time trigger (`maxTimeMs`). Publishes `ulpf.raw.ingest.v1` and `ulpf.merkle.leaf.v1` to local event bus.
- **Durable Spool:** Disk-backed write-ahead queue (`spool/*.jsonl`) diverting events during SQLite outages; automatically flushes and drains to DB upon recovery with zero data loss.

### `integrity-svc` (M2 Complete)
- **Merkle Tree Builder:** Deterministic leaf ordering by `lineage_id` guaranteeing identical roots regardless of leaf arrival order; spec padding rule (odd leaves duplicate last node); domain separation prefixes (`0x00` leaves, `0x01` internal); single-lineage sibling-hash proof generator and verifier.
- **Hash-Chained Signed Ledger:** Append-only signed JSONL file (`data/ledger.jsonl`), cryptographic Ed25519 signing using repo keypair (`keys/dev_signing.key`), chain verification checking contiguous sequence, prev_hash continuity, and cryptographic signature validity.
- **Anchor Service:** Orchestrates chunk closing, builds Merkle tree, records to signed ledger, updates `merkle_chunks` in SQLite, and backfills `raw_events` leaf indexes.
- **Deep Verification:** Re-reads raw zstd chunk files directly from disk, independently recomputes content seal SHA-256 for all raw slices, reconstructs Merkle tree, and validates against ledger anchor.
- **Tamper Drill Tooling:** Utility for deliberate byte-level raw chunk corruption, ledger line editing, or DB hash tampering. Verifies deep verify fails, isolates the altered leaf ID, and confirms untouched chunks verify (negative control).

### Review UI & Review API (M8 partial / developer preview)
- `review-api` (Port 4000): 16 REST endpoints with SQLite seed data and forward trace/verify stubs.
- `review-ui` (Port 3000): Dark-mode dashboard SPA with 5 views (Dashboard, Queue, Detail, Packs, Trace), 100% air-gap compliant (system fonts).

### Services Status
| Service | Language | Status |
|---|---|---|
| `ingestion-svc` | Node/TS | M1 complete: listeners, envelope generator, raw store (zstd), batcher, durable spool, 8/8 tests pass |
| `integrity-svc` | Node/TS | M2 complete: Merkle builder, signed ledger, anchor service, deep verify, tamper drill, 7/7 tests pass |
| `review-api` | Node/TS | 16 REST endpoints live on port 4000 |
| `review-ui` | Next.js | SPA running on port 3000 (air-gap safe) |
| `pipeline-svc` | Python | Empty modules: `router.py`, `normalization.py`, `pack_registry.py`, `coldpath/` |
| `sinks-svc` | Python | Empty module |

### CI / lint / test
- **Python:** `pytest` runs 16 tests (all pass).
- **TypeScript:** 37 tests pass (22 contract tests + 8 ingestion acceptance tests + 7 integrity acceptance tests).
- Total tests: **53/53 passing**.

## Update Log

_(Newest entry at the top.)_

| Date | Phase | What shipped | Verified by | New deviations logged? |
|---|---|---|---|---|
| 2026-09-26 | M2 | Full `integrity-svc` implementation: deterministic Merkle tree builder (spec padding rule, domain separation, sibling proofs), hash-chained signed JSONL ledger with Ed25519 signing, anchor service with SQLite `merkle_chunks` updates and `raw_events` backfill, deep verification from disk zstd bytes, tamper drill tooling | `vitest run` 7/7 tests pass (deterministic root regardless of arrival order, clean chunk verify, tamper drill failure & altered leaf isolation, negative control, edited ledger line detection), `tsc --noEmit` clean | No — adheres to architecture.md §3, §4, §5 |
| 2026-09-26 | M1 | Full `ingestion-svc` implementation: UDP/TCP/HTTP listeners, envelope generator, zstd raw store with offset index, dual-trigger batcher, SQLite `raw_events` writer, disk-backed durable spool, bus topics (`ulpf.raw.ingest.v1`, `ulpf.merkle.leaf.v1`) | `vitest run` 8/8 tests pass (fidelity, uniqueness, batch triggers, durable spool outage recovery, E2E listeners), `tsc --noEmit` clean | No — adheres to architecture.md §3, §4, §5 |
| 2026-09-26 | M0 | Full monorepo scaffold, 7 JSON Schema contracts, generated Pydantic+TS types, SQLite DB schema (8 tables), Ed25519 keygen, Makefile, 38 round-trip tests (16 Python + 22 TS), all lint/typecheck clean | `pytest` 16/16 pass, `vitest` 22/22 pass, `ruff check` 0 errors, `tsc --noEmit` 0 errors on 4 TS packages | No — all follows architecture.md |

## Open Questions / Blockers Right Now

- Final language choice for `integrity-svc` (Node vs. Python) — owner: blockchain developer, due end of M0 (see `prd.md` Section 8). Currently scaffolded as Node/TS.
- CI system not yet chosen/configured (GitHub Actions, GitLab CI, etc.) — the Makefile targets exist but no `.github/workflows/` or equivalent has been created.
- Confidence auto-accept threshold calibration is an M6 activity, not blocking M0.

## How to Update This File (read before editing)

1. Only add an entry after acceptance criteria for the relevant deliverable (per `phases.md`) have actually passed — not when code is written, not when it "should work."
2. State facts, not intentions: "ingestion-svc byte-fidelity test passes" not "ingestion-svc is basically done."
3. If something was built differently from what `architecture.md` or `phases.md` says, add a row to `architecture.md`'s Decisions Log **in the same session**, and reference it here.
4. When a phase's acceptance criteria are all met, update "Current Phase" at the top of this file to the next phase and reset "What Exists Right Now" to reflect the new baseline (keep the Update Log history, don't delete it).
5. If you are an LLM agent and you are not sure whether something has been built, **check the actual repo/code — do not infer from `phases.md` or from conversation history.** This file is only trustworthy if every entry was verified against real, running acceptance tests.
