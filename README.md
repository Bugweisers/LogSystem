# ULPF — Universal Log Pre-processing Framework

**Sponsor:** National Technical Research Organisation (NTRO) / NCIIPC
**Domain:** Blockchain-anchored cybersecurity log normalization for perimeter network devices
**Current phase:** **M0 — Contracts, Scaffold & Repo Setup** (see [`docs/context.md`](docs/context.md))

---

## 1. What This Is

ULPF ingests raw logs from perimeter devices (firewalls, IPS/IDS, VPN gateways, routers), preserves them byte-for-byte with a cryptographic seal, routes them through a deterministic parser (known formats) or an inferential engine (unknown formats), normalizes everything into OCSF, and ships it to a SIEM and a data lake — while every step remains traceable back to the original bytes via a blockchain-anchored Merkle proof.

## 2. Documentation Map

| Doc | Purpose |
|---|---|
| [`docs/prd.md`](docs/prd.md) | Every feature/requirement, MVP vs. full, success criteria |
| [`docs/architecture.md`](docs/architecture.md) | Services, data flow, DB schema, payload contracts, naming rules |
| [`docs/architecture.html`](docs/architecture.html) | **Interactive Architecture Diagram** — Standalone SVG visualization with views & trace |
| [`docs/EVALUATOR_WALKTHROUGH_SCRIPT.md`](docs/EVALUATOR_WALKTHROUGH_SCRIPT.md) | **15–20 Min Evaluator Presentation Script** — Video walkthrough & mentor defense guide |
| [`docs/design.md`](docs/design.md) | UI design system, page layouts, forms, API/CLI conventions |
| [`docs/phases.md`](docs/phases.md) | Coding phases M0–M8, deliverables, acceptance tests, owners |
| [`docs/context.md`](docs/context.md) | **Living** log of what's actually been built — read this first |
| [`docs/agent.md`](docs/agent.md) | Rules any contributor (human or LLM) must follow |
| `docs/spec/` | Original 14 full-spec documents (reference only) |

**Reading order:** `README.md` → `docs/context.md` → `docs/agent.md` → your area's section in `docs/architecture.md` and `docs/phases.md`.

## 3. Tech Stack

| Layer | Language | Purpose |
|---|---|---|
| Ingestion, Integrity, Review API | Node.js 20 + TypeScript | Listeners, Merkle/ledger, REST API |
| Pipeline, Cold Path, Sinks | Python 3.11+ | Parser, ML, normalization, OCSF, Parquet |
| Review UI | Next.js + React | Analyst interface |
| Shared Contracts | JSON Schema → Pydantic + TypeScript | Single source of truth |
| Data Stores (MVP) | SQLite, local filesystem, in-process bus | Upgradeable per `docs/phases.md` |

## 4. Repository Structure

```
ulpf/
├── README.md
├── Makefile
├── .gitignore
├── docs/                            # All documentation
│   ├── prd.md, architecture.md, design.md, phases.md
│   ├── context.md, agent.md
│   └── spec/                        # Original 14-doc full spec
├── packages/
│   └── contracts/
│       ├── schemas/                 # JSON Schema source of truth (7 schemas)
│       ├── python/                  # Generated Pydantic v2 models + DB schema
│       └── typescript/              # Generated TypeScript interfaces
├── packs/                           # Mapping pack YAML (base + vendor)
│   ├── base/
│   └── vendors/
├── services/
│   ├── ingestion-svc/               # Node/TS — C1
│   ├── integrity-svc/               # Node/TS — C2
│   ├── pipeline-svc/               # Python — C3, C5, C6
│   │   └── src/pipeline_svc/coldpath/  # Python — C4 (ML)
│   ├── sinks-svc/                   # Python — C8
│   ├── review-api/                  # Node/TS — C7 backend
│   └── review-ui/                   # Next.js — C7 frontend
├── tools/                           # keygen, sample generators, tamper drill
├── keys/                            # Ed25519 dev keypair (gitignored)
└── tests/
    └── e2e/                         # End-to-end tests
```

## 5. Getting Started

### Prerequisites

- Python 3.11+ with `pip`
- Node.js 20+ with `npm`
- `make` (optional but recommended)

### One-Line Docker Run (Recommended)

To spin up all 6 microservices in isolated, hardened containers with one command:

```bash
docker compose up --build -d
```

| Service | Container Name | Host URL / Port | Health Check |
|---|---|---|---|
| **Review UI** (Next.js Dashboard) | `ulpf-review-ui` | `http://localhost:3100` | `http://localhost:3100` |
| **Review API** (REST backend) | `ulpf-review-api` | `http://localhost:4000` | `http://localhost:4000/health` |
| **Ingestion Service** (Syslog / HTTP) | `ulpf-ingestion-svc` | `UDP :5140`, `TCP :5141`, `HTTP :5142` | `http://localhost:5142/health` |
| **Integrity Service** (Merkle / Ledger) | `ulpf-integrity-svc` | `http://localhost:5143` | `http://localhost:5143/health` |
| **Pipeline Service** (Parsers / OCSF) | `ulpf-pipeline-svc` | `http://localhost:8000` | `http://localhost:8000/health` |
| **Sinks Service** (SIEM / Parquet Lake) | `ulpf-sinks-svc` | `http://localhost:8001` | `http://localhost:8001/health` |

To stop the entire stack:
```bash
docker compose down
```

### Local Development Setup (Without Docker)

```bash
# Install all dependencies, run DB migration, generate dev keypair
make setup

# Or step by step:
pip install -e "packages/contracts/python[dev]"
cd packages/contracts/typescript && npm install
python -m ulpf_contracts.db_schema          # creates ulpf.db
python tools/keygen.py keys/                # creates Ed25519 dev keypair
```

### Generate Contracts (after schema changes)

```bash
make generate-contracts
# Or:
cd packages/contracts/python && python scripts/generate.py
cd packages/contracts/typescript && node scripts/generate.mjs
```

### Lint, Type-Check & Test

```bash
make ci          # runs lint + typecheck + test

# Or individually:
make lint        # ruff (Python) + tsc (TypeScript)
make typecheck   # mypy (Python) + tsc (TypeScript)
make test        # pytest (Python) + vitest (TypeScript)
```

## 6. Contributing

Read [`docs/agent.md`](docs/agent.md) before writing any code — it applies to human contributors and AI coding agents equally.
