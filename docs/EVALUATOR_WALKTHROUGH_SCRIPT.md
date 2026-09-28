# Universal Log Pre-processing Framework (ULPF)
## 15–20 Minute Evaluator Video Presentation Script & Codebase Walkthrough

> **Audience:** DIH Technical Evaluators, Mentors, and Enterprise Architecture Reviewers  
> **Target Video Runtime:** 18 minutes (Range: 15–20 minutes)  
> **Interactive Architecture Diagram:** [`docs/architecture.html`](file:///d:/PROGRAMMING/projects/ULPF/docs/architecture.html)  
> **Repository Root:** `d:/PROGRAMMING/projects/ULPF`

---

## Table of Contents
1. [Executive Overview & DIH Compliance Matrix](#1-executive-overview--dih-compliance-matrix)
2. [Codebase Architecture & Directory Map](#2-codebase-architecture--directory-map)
3. [The 15–20 Minute Video Presentation Script](#3-the-1520-minute-video-presentation-script)
   - [Act I: The Enterprise Log Crisis & The ULPF Solution (0:00 – 2:00)](#act-i-the-enterprise-log-crisis--the-ulpf-solution-000--200)
   - [Act II: Runtime Architecture & The 3 Demarcation Tiers (2:00 – 5:00)](#act-ii-runtime-architecture--the-3-demarcation-tiers-200--500)
   - [Act III: Ingestion, Byte-Fidelity & Durable Spooling (5:00 – 8:30)](#act-iii-ingestion-byte-fidelity--durable-spooling-500--830)
   - [Act IV: Dual-Path Preprocessing, Drain3 & OCSF Normalization (8:30 – 12:00)](#act-iv-dual-path-preprocessing-drain3--ocsf-normalization-830--1200)
   - [Act V: Self-Learning Loop, Review Console & RCU Hot-Reload (12:00 – 15:30)](#act-v-self-learning-loop-review-console--rcu-hot-reload-1200--1530)
   - [Act VI: Cryptographic Merkle Ledger & Enterprise Sinks (15:30 – 18:00)](#act-vi-cryptographic-merkle-ledger--enterprise-sinks-1530--1800)
   - [Act VII: Air-Gap Verification, Benchmarks & Closing (18:00 – 20:00)](#act-vii-air-gap-verification-benchmarks--closing-1800--2000)
4. [Presenter Terminal Runbook (Live Demo Commands)](#4-presenter-terminal-runbook-live-demo-commands)
5. [Evaluator Q&A Defense Guide (Tough Mentor Questions)](#5-evaluator-qa-defense-guide-tough-mentor-questions)

---

## 1. Executive Overview & DIH Compliance Matrix

Modern enterprises generate massive volumes of logs across heterogeneous platforms (Syslog, JSON, XML, CSV, CEF, LEEF, and proprietary formats). This causes **SIEM ingestion licensing bloat**, **parser development bottlenecks**, and **blind spots during forensic investigations**.

ULPF solves this by introducing a **resilient, air-gapped, dual-path preprocessing and self-learning normalization framework** that guarantees 100% byte fidelity while transforming raw events into canonical **OCSF v1.2.0 Class 4001 (Network Activity)** records.

### DIH Requirements Traceability Matrix

| DIH Requirement | ULPF Implementation | Key Files & Verification Proofs |
| :--- | :--- | :--- |
| **a) Preserve complete raw event data without information loss** | Ingestion captures exact raw bytes into `IngestEnvelope` with SHA-256 content seals and compresses into Zstandard chunks (`.idx.json` offset indexing). | [`services/ingestion-svc/src/raw_store.ts`](file:///d:/PROGRAMMING/projects/ULPF/services/ingestion-svc/src/raw_store.ts)<br>Test: `pnpm --filter @ulpf/ingestion-svc test` (`fidelity.test.ts`) |
| **b) Extract and parse source-specific attributes** | High-performance regex extraction in hot path; automated Drain3 template extraction in cold path. | [`services/pipeline-svc/src/pipeline_svc/drain.py`](file:///d:/PROGRAMMING/projects/ULPF/services/pipeline-svc/src/pipeline_svc/drain.py)<br>[`packs/vendors/cisco_asa_v1.3.0.yaml`](file:///d:/PROGRAMMING/projects/ULPF/packs/vendors/cisco_asa_v1.3.0.yaml) |
| **c) Normalize fields into a common event taxonomy** | 3-Layer normalizer enforcing **OCSF v1.2.0 Class 4001 (Network Activity)** with IPv4 zero-stripping, RFC 5952 IPv6 compression, and port range validation. | [`services/pipeline-svc/src/pipeline_svc/normalizer.py`](file:///d:/PROGRAMMING/projects/ULPF/services/pipeline-svc/src/pipeline_svc/normalizer.py)<br>Test: `pytest services/pipeline-svc/tests/test_normalizer.py` |
| **d) Maintain traceability between normalized and original events** | Strict invariant: `ocsf.metadata.uid == raw_event._lineage_id`. Backed by 1,000-leaf SHA-256 Merkle trees anchoring raw chunk offsets (`raw_store://chunk_.../offset_N`). | [`services/integrity-svc/src/merkle.ts`](file:///d:/PROGRAMMING/projects/ULPF/services/integrity-svc/src/merkle.ts)<br>Test: `pnpm --filter @ulpf/integrity-svc test` |
| **e) Plug-and-play onboarding of new log sources** | Declarative YAML mapping packs with multi-level inheritance, compiled regex, and dynamic loader. | [`packs/base/base_network.yaml`](file:///d:/PROGRAMMING/projects/ULPF/packs/base/base_network.yaml)<br>[`services/pipeline-svc/src/pipeline_svc/pack_compiler.py`](file:///d:/PROGRAMMING/projects/ULPF/services/pipeline-svc/src/pipeline_svc/pack_compiler.py) |
| **f) Unified visibility across enterprise environments** | Standalone Next.js 15 Analyst Dashboard (`review-ui` on `:3000`) with live OCSF stream, cluster review queue, and forward lineage trace viewer. | [`services/review-ui/src/app/page.tsx`](file:///d:/PROGRAMMING/projects/ULPF/services/review-ui/src/app/page.tsx)<br>[`services/review-api/src/server.ts`](file:///d:/PROGRAMMING/projects/ULPF/services/review-api/src/server.ts) |
| **g) Efficient SIEM and Data Lake integration** | Dual-speed streaming architecture: Partitioned Apache Parquet data lake (`pyarrow`) + low-latency Splunk HEC/CEF/JSONL stream. | [`services/sinks-svc/src/sinks_svc/parquet.py`](file:///d:/PROGRAMMING/projects/ULPF/services/sinks-svc/src/sinks_svc/parquet.py)<br>[`services/sinks-svc/src/sinks_svc/siem.py`](file:///d:/PROGRAMMING/projects/ULPF/services/sinks-svc/src/sinks_svc/siem.py) |
| **h) AI/ML-ready security and operational analytics** | Parquet data lake with nested structs and per-field `_confidence` metrics directly queryable via `pandas.read_parquet()` with zero preprocessing. | [`services/sinks-svc/tests/test_parquet_sink.py`](file:///d:/PROGRAMMING/projects/ULPF/services/sinks-svc/tests/test_parquet_sink.py) |
| **i) Reduced parser development effort** | Unsupervised Drain3 prefix tree clustering + TF-IDF/FastText lexical semantic mapper automates 90% of rule authoring; analyst confirms in 1 click. | [`services/pipeline-svc/src/pipeline_svc/drain.py`](file:///d:/PROGRAMMING/projects/ULPF/services/pipeline-svc/src/pipeline_svc/drain.py)<br>[`services/pipeline-svc/src/pipeline_svc/semantic_mapper.py`](file:///d:/PROGRAMMING/projects/ULPF/services/pipeline-svc/src/pipeline_svc/semantic_mapper.py) |
| **j) Deployable in an air-gapped network** | 100% offline verified: zero external CDN scripts/fonts, bundled typography, self-contained dependencies, and offline vector models. | [`tools/check_airgap.py`](file:///d:/PROGRAMMING/projects/ULPF/tools/check_airgap.py)<br>[`docker/docker-compose.airgap.yml`](file:///d:/PROGRAMMING/projects/ULPF/docker/docker-compose.airgap.yml) |
| **k) Containerized & platform-independent** | 6 hardened multi-stage Dockerfiles (`docker/Dockerfile.*`) with non-root execution (UID 1000/10001) and minimal scratch/alpine runtime images. | [`docker/docker-compose.yml`](file:///d:/PROGRAMMING/projects/ULPF/docker/docker-compose.yml) |

---

## 2. Codebase Architecture & Directory Map

```
ULPF/
├── packages/
│   └── contracts/                 # Cross-language Single Source of Truth
│       ├── schemas/               # 7 strict JSON Schemas (raw_ingest, merkle_leaf, ocsf_event...)
│       ├── python/                # Auto-generated Pydantic v2 dataclasses
│       └── typescript/            # Auto-generated TypeScript types
├── services/
│   ├── ingestion-svc/             # Node.js/TS: UDP/TCP :514, HTTP :5142, Zstd raw store, Durable Spool
│   ├── integrity-svc/             # Node.js/TS: 1k-leaf SHA-256 Merkle tree builder, Ed25519 signed ledger
│   ├── pipeline-svc/              # Python: Dual-path router, Drain3 miner, OCSF normalizer, RCU engine
│   ├── sinks-svc/                 # Python: PyArrow Parquet data lake writer & SIEM CEF/JSONL sink
│   ├── review-api/                # Node.js/TS Express on :4000: 16 REST endpoints, SQLite integration
│   └── review-ui/                 # Next.js 15 SPA on :3000: Dark-mode analyst console, lineage trace
├── packs/                         # Declarative signed YAML parser packs (base_network, cisco_asa)
├── tools/                         # Operational CLI suite (benchmark.py, check_airgap.py, keygen.py)
├── data/                          # Runtime persistence (ulpf.db, raw_store/, ledger.jsonl, sinks/)
└── docs/                          # Architecture specs, PRD, and interactive HTML diagrams
```

---

## 3. The 15–20 Minute Video Presentation Script

### Visual Cue Reference Guide
- `[SHOW SCREEN]` What should be visible on the recording monitor.
- `[SHOW CODE]` Which file and line number to open in the IDE.
- `[RUN COMMAND]` Terminal command to execute live.
- `[TALKING POINTS]` Spoken narration for the presenter.

---

### Act I: The Enterprise Log Crisis & The ULPF Solution (0:00 – 2:00)
**Goal:** Hook the evaluators immediately by defining the core enterprise security problem and introducing ULPF's value proposition.

- `[SHOW SCREEN]` Title slide or IDE showing [`README.md`](file:///d:/PROGRAMMING/projects/ULPF/README.md).
- `[TALKING POINTS]`
  > "Hello everyone. Welcome to the technical evaluation walkthrough of the **Universal Log Pre-processing Framework (ULPF)**.
  >
  > Today, enterprise Security Operations Centers (SOCs) and data engineering teams face an unsustainable crisis. A typical Fortune 500 company ingests tens of terabytes of logs daily across firewalls, cloud infrastructure, Active Directory, IoT devices, and container clusters. These arrive in hundreds of fragmented formats: Syslog RFC 3164, RFC 5424, CEF, LEEF, raw CSV, and proprietary key-value payloads.
  >
  > This diversity creates three massive operational failures:
  > 1. **Massive SIEM Licensing Bloat:** Teams pay astronomical ingest costs to index garbage tokens and unstructured text.
  > 2. **Fragile Parser Pipelines:** Security engineers spend weeks hand-crafting brittle regex parsers that break with minor vendor firmware updates.
  > 3. **The Auditability Trap:** When a parser strips or truncates a field to fit a schema, raw evidentiary data is permanently lost—rendering forensic investigations legally vulnerable.
  >
  > To solve this, our team engineered **ULPF**—an air-gap deployable, dual-path preprocessing and self-learning normalization framework that guarantees **100% raw byte fidelity**, maps events into the **OCSF v1.2.0 Class 4001** taxonomy, and continuously self-learns unknown formats without dropping a single packet."

---

### Act II: Runtime Architecture & The 3 Demarcation Tiers (2:00 – 5:00)
**Goal:** Show evaluators the high-level architecture diagram and explain the 14 core components and data flow direction.

- `[SHOW SCREEN]` Open the interactive architecture diagram in the browser: [`docs/architecture.html`](file:///d:/PROGRAMMING/projects/ULPF/docs/architecture.html).
- `[TALKING POINTS]`
  > "Let us look at the high-level runtime architecture of ULPF. We generated this interactive specification using Archify, representing all 14 core components across 3 strictly decoupled operational tiers.
  >
  > *(Click on View 01: Ingestion & Raw Preservation)*
  >
  > **Tier 1: Ingress & Lossless Storage Demarcation**  
  > At the perimeter, log sources stream over UDP and TCP port 514, or batch via HTTP port 5142. The `Ingestion Service` immediately seals the raw payload with a SHA-256 hash and writes it into the `Lossless Raw Store` using Zstandard compressed chunks. Even if downstream databases crash, our built-in **Durable Disk Spool** prevents any packet drops.
  >
  > *(Click on View 02: Dual-Path Preprocessing & Self-Learning Core)*
  >
  > **Tier 2: The Dual-Path Processing Core**  
  > Ingested envelopes publish to the internal event bus. The `Dual-Path Router` inspects incoming logs against active parser templates:
  > - **The Hot Path ($\ge 0.85$ confidence):** Dispatches directly to the `RCU Engine` for microsecond-speed compilation and field extraction.
  > - **The Cold Path ($< 0.85$ confidence):** When unknown or mutated log formats arrive, they are safely diverted to our unsupervised `Drain3 Clustering Engine` and offline lexical semantic mapper. The templates cluster, synthesize draft packs, and queue for analyst confirmation in the `Review UI`.
  > - **Zero-Downtime Hot Reload:** Once an analyst approves a pack, it is signed with Ed25519 and atomically swapped into memory using a Read-Copy-Update (RCU) state machine—**zero process restarts, zero dropped events**.
  >
  > *(Click on View 03: Cryptographic Ledger & Enterprise Sinks)*
  >
  > **Tier 3: Cryptographic Ledger & Analytical Sinks**  
  > Concurrently, the `Integrity Service` batches incoming log seals into 1,000-leaf Merkle trees, anchoring roots into an immutable cryptographic ledger. Finally, normalized OCSF Class 4001 events fan out simultaneously to a partitioned Apache Parquet data lake for AI/ML workloads, and a low-latency CEF/JSONL stream for enterprise SIEMs like Splunk and Microsoft Sentinel."

---

### Act III: Ingestion, Byte-Fidelity & Durable Spooling (5:00 – 8:30)
**Goal:** Prove DIH Requirement (a) by inspecting code and running live tests demonstrating bit-for-bit raw byte recovery.

- `[SHOW CODE]` Open [`services/ingestion-svc/src/index.ts`](file:///d:/PROGRAMMING/projects/ULPF/services/ingestion-svc/src/index.ts) and [`services/ingestion-svc/src/raw_store.ts`](file:///d:/PROGRAMMING/projects/ULPF/services/ingestion-svc/src/raw_store.ts).
- `[TALKING POINTS]`
  > "Let's dive into the implementation. In `services/ingestion-svc`, our primary architectural goal is **strict byte fidelity**.
  >
  > Notice lines 45–60 in `index.ts`: when a packet arrives on UDP `:514`, TCP `:514`, or HTTP `:5142`, we do NOT mutate or strip any characters. We generate:
  > 1. A unique UUIDv4 `lineage_id`.
  > 2. A 64-character lowercase SHA-256 `content_seal` computed directly on the incoming byte buffer.
  > 3. An ISO-8601 UTC microsecond timestamp.
  >
  > Look at `raw_store.ts`. Events are compressed using Zstandard frame compression into append-only chunk files under `data/raw_store/`. Alongside each `.zst` chunk, we maintain a companion index `.idx.json` recording byte offset and compressed length. This guarantees that any forensic auditor can retrieve the exact original bytes years later."

- `[RUN COMMAND]` In Terminal 1, run the ingestion unit test suite:
  ```bash
  pnpm --filter @ulpf/ingestion-svc test
  ```
- `[SHOW SCREEN]` Point to `fidelity.test.ts` passing (8/8 tests passed).
- `[TALKING POINTS]`
  > "Notice the test `fidelity.test.ts` passing here. It sends raw Syslog strings with trailing null bytes, irregular spaces, and multibyte UTF-8 sequences. The test decompresses the slice directly from disk and asserts `buffer.equals(original) === true`.
  >
  > Furthermore, look at `durable_spool.ts`. If SQLite locks up under high load, the ingestion service transparently diverts envelopes to a disk-backed write-ahead queue (`spool/*.jsonl`). As soon as database lock contention clears, the spool flushes in FIFO order with zero data loss."

---

### Act IV: Dual-Path Preprocessing, Drain3 & OCSF Normalization (8:30 – 12:00)
**Goal:** Show how the pipeline achieves both microsecond throughput on known logs and automatic clustering on unknown logs.

- `[SHOW CODE]` Open [`services/pipeline-svc/src/pipeline_svc/router.py`](file:///d:/PROGRAMMING/projects/ULPF/services/pipeline-svc/src/pipeline_svc/router.py) and [`services/pipeline-svc/src/pipeline_svc/normalizer.py`](file:///d:/PROGRAMMING/projects/ULPF/services/pipeline-svc/src/pipeline_svc/normalizer.py).
- `[TALKING POINTS]`
  > "Now let us examine the pipeline processing engine in `services/pipeline-svc`.
  >
  > In `router.py`, incoming logs hit the `DualPathRouter`. We compute template match confidence:
  > - If confidence $\ge 0.85$, it matches an active compiled pack and takes the **Hot Path**.
  > - If confidence $< 0.85$, it takes the **Cold Path**.
  >
  > Let's look at `normalizer.py`. ULPF implements a **3-Layer Canonicalization Architecture**:
  > 1. **Layer 1 (Crosswalk):** Maps regex extraction tokens to OCSF 4001 attribute names (e.g. `src_ip`, `dst_port`, `action`).
  > 2. **Layer 2 (Canonicalizers):**
  >    - **IP Addresses:** Zero-stripped IPv4 (e.g., `192.168.001.001` becomes `192.168.1.1`) and RFC 5952 compliant IPv6 compression.
  >    - **Port Ranges:** Enforces strict integer boundaries `[0, 65535]`.
  >    - **Timestamps:** Normalizes BSD Syslog and ISO-8601 to epoch milliseconds.
  > 3. **Layer 3 (OCSF Assembly):** Builds the validated `OcsfNetworkActivityV1` schema.
  >
  > Notice the critical invariant on line 112: `ocsf_event.metadata.uid = raw_event.lineage_id`. This guarantees end-to-end cryptographic traceability from the SIEM alert all the way back to the raw chunk byte offset."

- `[RUN COMMAND]` In Terminal 2, run the pipeline regression suite:
  ```bash
  python -m pytest services/pipeline-svc/tests/ -v
  ```
- `[SHOW SCREEN]` Point to all 22 tests passing, including `test_rcu_hot_reload.py` and `test_normalizer.py`.
- `[TALKING POINTS]`
  > "All 22 unit tests pass across our compiler, RCU engine, and Drain3 miner. Notice `test_rcu_hot_reload.py`: we continuously stream events through the pipeline while loading a new pack on a separate thread. Zero events are dropped, and no event ever sees a partial or corrupted parser state."

---

### Act V: Self-Learning Loop, Review Console & RCU Hot-Reload (12:00 – 15:30)
**Goal:** Walk through the analyst UX in `review-ui` on port 3000, showing cold-path clustering, field mapping, Ed25519 signing, and atomic hot-reload.

- `[SHOW SCREEN]` Switch to the browser at `http://localhost:3000/queue`.
- `[TALKING POINTS]`
  > "Now let us demonstrate the **Self-Learning Auto-Onboarding Loop** in our Review Console.
  >
  > When novel log formats (such as unparsed firewall logs or custom application events) hit ULPF, the unsupervised Drain3 tree clusters them into structural templates.
  >
  > Here in the Review Queue at `http://localhost:3000/queue`, we see real clusters grouped by template. Notice:
  > - Cluster ID, sample count, and first/last seen timestamps.
  > - Variable tokens extracted dynamically as `<*>` wildcards.
  > - The lexical semantic mapper has pre-populated candidate mappings against OCSF attributes with confidence scores."

- `[SHOW SCREEN]` Click on one of the clusters (e.g. `http://localhost:3000/queue/drain-cluster-0288`).
- `[TALKING POINTS]`
  > "Inside the cluster review page:
  > 1. We inspect raw log instances side-by-side with extracted token variables.
  > 2. We verify the suggested field mappings: `src_ip`, `dst_port`, `protocol_name`.
  > 3. If an analyst disagrees, they can easily override the target OCSF field or regex token.
  >
  > *(Click 'Approve & Promote Pack')*
  >
  > Watch what happens behind the scenes:
  > 1. `review-api` compiles this approved cluster into a production-grade YAML pack under `packs/active/`.
  > 2. The pack is canonically hashed and **cryptographically signed using our Ed25519 private key** (`keys/dev_signing.key`).
  > 3. The `PackRegistry` detects the new signed pack, verifies its signature against the trusted public key, and triggers an **atomic RCU snapshot swap**.
  >
  > From this exact millisecond forward, all future logs matching this format immediately bypass the review queue and take the **Hot Path at 1.0 confidence**! We have eliminated the weeks-long manual parser development cycle."

---

### Act VI: Cryptographic Merkle Ledger & Enterprise Sinks (15:30 – 18:00)
**Goal:** Prove tamper-evident auditing (DIH Requirement d) and demonstrate Parquet and SIEM output integration (DIH Requirements g & h).

- `[SHOW CODE]` Open [`services/integrity-svc/src/merkle.ts`](file:///d:/PROGRAMMING/projects/ULPF/services/integrity-svc/src/merkle.ts).
- `[TALKING POINTS]`
  > "Now let's examine the cryptographic integrity foundation in `services/integrity-svc`.
  >
  > Look at `merkle.ts`:
  > - Raw event seals are ordered deterministically by `lineage_id`.
  > - We apply cryptographic domain separation: `0x00` byte prefixes for leaves, `0x01` byte prefixes for internal nodes, preventing second-preimage attacks.
  > - Every 1,000 logs, a Merkle root is calculated, signed with Ed25519, and committed to `data/ledger.jsonl`.
  > - In the Review UI at `/trace/[lineageId]`, an investigator can paste any log ID. The system generates an immediate sibling-hash proof verifying that the log currently in the SIEM is bit-for-bit identical to what arrived at the network edge."

- `[RUN COMMAND]` Run the integrity test suite to prove tamper isolation:
  ```bash
  pnpm --filter @ulpf/integrity-svc test
  ```
- `[SHOW SCREEN]` Point to `tamper_drill.test.ts` passing (7/7 tests passed).
- `[TALKING POINTS]`
  > "Notice `tamper_drill.test.ts`: our drill intentionally modifies a single byte in a raw chunk file on disk. The deep verification engine instantly flags the exact corrupted chunk, identifies the altered leaf ID, and confirms all untouched chunks remain 100% valid."

- `[SHOW CODE]` Open [`services/sinks-svc/src/sinks_svc/parquet.py`](file:///d:/PROGRAMMING/projects/ULPF/services/sinks-svc/src/sinks_svc/parquet.py).
- `[RUN COMMAND]` Run the sinks unit test:
  ```bash
  python -m pytest services/sinks-svc/tests/ -v
  ```
- `[TALKING POINTS]`
  > "Looking at `sinks-svc`, all 7 tests pass.
  > 1. **Parquet Data Lake:** Formatted with strongly-typed PyArrow schemas, partitioned by date (`year=YYYY/month=MM/day=DD/`). It embeds per-field `_confidence` metadata, making it instantly queryable by security data scientists using Pandas, DuckDB, or Apache Spark with zero data wrangling.
  > 2. **SIEM Streaming Sink:** Simultaneously formats events into RFC-compliant CEF and JSONL strings for real-time SOC alerting."

---

### Act VII: Air-Gap Verification, Benchmarks & Closing (18:00 – 20:00)
**Goal:** Conclude with proof of 100% air-gap compliance, production benchmarks, and final summary.

- `[RUN COMMAND]` Execute the air-gap compliance scanner in Terminal 1:
  ```bash
  python tools/check_airgap.py
  ```
- `[SHOW SCREEN]` Show the air-gap check output: `ALL AIR-GAP CHECKS PASSED: 100% Offline Safe`.
- `[TALKING POINTS]`
  > "One of our most critical achievements is **100% Air-Gap Compliance (DIH Requirement j)**.
  >
  > Look at the terminal output: `tools/check_airgap.py` scans every HTML, CSS, JavaScript, and Python file across all 6 services. It verifies:
  > - Zero external CDN links (no Google Fonts, no unpkg, no external CDNs).
  > - Native system fonts and offline bundled typography (JetBrains Mono).
  > - Completely local vector embeddings and rule files.
  > - A runtime socket drill ensuring zero outbound internet connections.
  >
  > ULPF is ready to deploy immediately in secure, classified, and isolated defense environments."

- `[RUN COMMAND]` Run the performance benchmark suite:
  ```bash
  python tools/benchmark.py
  ```
- `[SHOW SCREEN]` Point to the benchmark throughput results:
  - Ingestion Content Seal: **~447,000 events/sec** (p50: 1.6µs)
  - Merkle Tree Builder: **~1,126,000 leaves/sec**
  - Hot-Path Regex Router: **~48,000 events/sec**
  - OCSF Normalization: **~41,000 events/sec**
- `[TALKING POINTS]`
  > "Finally, let's look at the performance benchmarks:
  > - Raw ingress and SHA-256 sealing executes at over **447,000 events per second** with a median latency of 1.6 microseconds.
  > - Merkle tree construction handles over **1.1 million leaves per second**.
  > - End-to-end normalization sustains over **41,000 events per second per core**.
  >
  > In conclusion, ULPF fulfills all DIH requirements: it preserves raw forensic truth, automates parser creation through Drain3 and RCU hot reloads, normalizes to OCSF v1.2.0, provides full cryptographic provenance, and runs completely offline in an air-gapped containerized deployment.
  >
  > Thank you for your time and evaluation."

---

## 4. Presenter Terminal Runbook (Live Demo Commands)

Keep these terminal tabs ready prior to starting the video recording:

### Tab 1: Service Daemons (Background)
```powershell
# 1. Start Ingestion Service (UDP :514, HTTP :5142)
pnpm --filter @ulpf/ingestion-svc dev

# 2. Start Review API daemon (Port 4000)
pnpm --filter @ulpf/review-api dev

# 3. Start Review UI analyst console (Port 3000)
pnpm --filter @ulpf/review-ui dev
```

### Tab 2: Test & Verification Commands (Run during recording)
```powershell
# 1. Ingestion Byte-Fidelity Test (Act III)
pnpm --filter @ulpf/ingestion-svc test

# 2. Pipeline Regex & RCU Hot-Reload Test (Act IV)
python -m pytest services/pipeline-svc/tests/ -v

# 3. Merkle Integrity & Tamper Drill Test (Act VI)
pnpm --filter @ulpf/integrity-svc test

# 4. Sinks Parquet & SIEM Test (Act VI)
python -m pytest services/sinks-svc/tests/ -v

# 5. Air-Gap Offline Compliance Audit (Act VII)
python tools/check_airgap.py

# 6. High-Throughput Micro-Benchmark (Act VII)
python tools/benchmark.py
```

### Tab 3: Live Log Ingestion Drill (Optional interactive injection)
```powershell
# Send a test Syslog packet over HTTP
Invoke-RestMethod -Uri http://localhost:5142/ingest -Method Post -Body "Sep 28 01:15:00 firewall-core %ASA-4-106023: Deny tcp src outside:198.51.100.15/443 dst inside:10.0.0.5/51234 by access-group 'OUTSIDE_IN'" -ContentType "text/plain"
```

---

## 5. Evaluator Q&A Defense Guide (Tough Mentor Questions)

### Q1: "How do you guarantee that high-speed UDP logs aren't dropped when your SQLite database is under write lock?"
**Answer:**  
"We implement a **Durable Disk Spool** in `services/ingestion-svc/src/durable_spool.ts`. The network socket listener runs on an asynchronous non-blocking event loop. When a database lock contention or filesystem backpressure occurs, envelopes are immediately diverted to append-only JSONL files in `spool/`. Once SQLite write locks release, a dedicated worker flushes and drains the spool in strict FIFO order. Furthermore, we decouple the high-speed socket receiver from downstream normalization using internal pub/sub queues."

---

### Q2: "Why did you choose Drain3 and lexical semantic mapping instead of an LLM for log parsing?"
**Answer:**  
"Three fundamental engineering reasons:
1. **Air-Gap & Latency:** In classified defense or disconnected enterprise environments, calling cloud LLM APIs violates air-gap constraints. Drain3 runs completely offline and parses templates in sub-millisecond time, whereas an LLM adds hundreds of milliseconds of latency and massive GPU power requirements.
2. **Determinism:** Security pipelines require deterministic grouping. Drain3’s prefix-tree algorithm groups logs based on exact token boundaries without LLM hallucination risk.
3. **Analyst-in-the-Loop Safety:** Drain3 clusters the templates and our semantic mapper proposes candidate fields; the human analyst confirms the mapping with one click, generating a signed, auditable YAML pack."

---

### Q3: "What prevents two analysts from confirming conflicting packs for the same cluster simultaneously?"
**Answer:**  
"We implemented **Optimistic Concurrency Control with HTTP 409 Conflict Detection** in `services/review-api/src/routes/queue.ts`. When an analyst opens a cluster, a state lock/revision token is fetched. When submitting a confirmation, the API verifies that the cluster status is still `pending`. If another analyst confirmed it a second earlier, the transaction is rejected with HTTP 409, and the UI displays a `ConflictBanner` preventing duplicate or conflicting pack compilation."

---

### Q4: "How does your RCU engine hot-reload parser packs without restarting the Python process or dropping events?"
**Answer:**  
"In `services/pipeline-svc/src/pipeline_svc/rcu.py`, we implement a classic **Read-Copy-Update (RCU)** pattern. The running router holds an atomic pointer to an immutable `RegistrySnapshot`. When a new signed YAML pack is loaded:
1. A new snapshot object is compiled in the background.
2. The active registry pointer is swapped atomically using Python's GIL reference update.
3. In-flight requests continue executing against the old snapshot without interruption.
4. Subsequent requests immediately execute against the new snapshot.
Zero locks, zero thread stalls, and zero downtime."

---

### Q5: "How does an auditor prove that a log retrieved from the SIEM was not tampered with inside the data lake?"
**Answer:**  
"Every normalized event carries `metadata.uid == lineage_id`. This `lineage_id` acts as a leaf in our **SHA-256 Merkle Tree** (`services/integrity-svc`). Every 1,000 events, the tree root is signed with an Ed25519 key and appended to `data/ledger.jsonl`.
In the Review UI at `/trace/[lineageId]`, our verification engine traverses the Merkle tree, produces the sibling hashes up to the signed root, and checks the signature. If a single byte of the log was modified in the database or Parquet file, the computed root hash fails to match the ledger anchor, pinpointing the exact tampering."
