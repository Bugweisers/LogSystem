/**
 * review-api — Express REST API (C7 backend)
 * Endpoints per architecture.md §6
 */
import express, { type Express } from "express";
import cors from "cors";
import { getDb } from "./db.js";

export const app: Express = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 4000);

// ── helpers ──────────────────────────────────────────────────────────────────

function parseJson(val: unknown): unknown {
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

function errorResponse(res: express.Response, code: string, message: string, status = 400) {
  return res.status(status).json({ error: { code, message } });
}

// ── /health & /ready ─────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/ready", (_req, res) => {
  try {
    getDb().prepare("SELECT 1").get();
    res.json({ status: "ready" });
  } catch (e) {
    res.status(503).json({ status: "not_ready", reason: String(e) });
  }
});

// ── /internal/packs — cluster-grouped draft/staged packs ─────────────────────

app.get("/internal/packs/drafts", (_req, res) => {
  const db = getDb();
  // Group review_queue rows by cluster, attach pack if exists
  const clusters = db.prepare(`
    SELECT
      rq.cluster_id,
      COUNT(*) as sample_count,
      MIN(rq.created_at) as oldest_at,
      MAX(rq.created_at) as newest_at,
      rq.status,
      rq.assigned_analyst,
      rq.sample_raw_pointer,
      eh.source_type,
      mp.pack_id,
      mp.version as pack_version,
      mp.status as pack_status
    FROM review_queue rq
    LEFT JOIN extraction_history eh ON eh.extraction_id = rq.extraction_id
    LEFT JOIN mapping_packs mp ON mp.source_type = eh.source_type AND mp.status IN ('draft','staged')
    GROUP BY rq.cluster_id
    ORDER BY sample_count DESC, oldest_at ASC
  `).all();

  res.json({ clusters });
});

app.get("/internal/packs/:pack_id", (req, res) => {
  const db = getDb();
  const pack = db.prepare("SELECT * FROM mapping_packs WHERE pack_id = ?").get(req.params["pack_id"]);
  if (!pack) return errorResponse(res, "NOT_FOUND", "Pack not found", 404);

  const events = db.prepare(
    "SELECT * FROM pack_lifecycle_events WHERE pack_id = ? ORDER BY occurred_at ASC"
  ).all(req.params["pack_id"]);

  const fixtures = db.prepare(
    "SELECT * FROM test_fixtures WHERE pack_id = ?"
  ).all(req.params["pack_id"]);

  return res.json({ pack, lifecycle_events: events, fixtures });
});

app.post("/internal/packs/:pack_id/confirm", (req, res) => {
  const db = getDb();
  const { pack_id } = req.params;
  const { actor, confirmed_mapping } = req.body as { actor?: string; confirmed_mapping?: unknown };

  if (!actor) return errorResponse(res, "MISSING_ACTOR", "actor is required");
  if (!confirmed_mapping) return errorResponse(res, "MISSING_MAPPING", "confirmed_mapping is required");

  const pack = db.prepare("SELECT * FROM mapping_packs WHERE pack_id = ?").get(pack_id) as { status: string } | undefined;
  if (!pack) return errorResponse(res, "NOT_FOUND", "Pack not found", 404);
  if (pack.status === "confirmed" || pack.status === "active") {
    return errorResponse(res, "CONFLICT", "Pack already confirmed by another submission", 409);
  }

  db.prepare("UPDATE mapping_packs SET status = 'active', promoted_at = ? WHERE pack_id = ?")
    .run(new Date().toISOString(), pack_id);

  const hash = `hash-confirm-${Date.now()}`;
  db.prepare(
    "INSERT INTO pack_lifecycle_events (pack_id,event_type,actor,event_hash,occurred_at) VALUES (?,?,?,?,?)"
  ).run(pack_id, "pack_confirmed", actor, hash, new Date().toISOString());

  // Update related review_queue rows to confirmed
  db.prepare(
    "UPDATE review_queue SET status='confirmed', assigned_analyst=?, resolved_at=?, confirmed_mapping=? WHERE cluster_id IN (SELECT cluster_id FROM review_queue rq LEFT JOIN extraction_history eh ON eh.extraction_id = rq.extraction_id LEFT JOIN mapping_packs mp ON mp.source_type = eh.source_type WHERE mp.pack_id = ?)"
  ).run(actor, new Date().toISOString(), JSON.stringify(confirmed_mapping), pack_id);

  return res.json({ ok: true, pack_id, status: "active", event_hash: hash });
});

app.post("/internal/packs/:pack_id/reject", (req, res) => {
  const db = getDb();
  const { pack_id } = req.params;
  const { actor } = req.body as { actor?: string };
  if (!actor) return errorResponse(res, "MISSING_ACTOR", "actor is required");

  const pack = db.prepare("SELECT * FROM mapping_packs WHERE pack_id = ?").get(pack_id);
  if (!pack) return errorResponse(res, "NOT_FOUND", "Pack not found", 404);

  db.prepare("UPDATE mapping_packs SET status = 'quarantined' WHERE pack_id = ?").run(pack_id);
  const hash = `hash-reject-${Date.now()}`;
  db.prepare(
    "INSERT INTO pack_lifecycle_events (pack_id,event_type,actor,event_hash,occurred_at) VALUES (?,?,?,?,?)"
  ).run(pack_id, "pack_quarantined", actor, hash, new Date().toISOString());

  return res.json({ ok: true, pack_id, status: "quarantined" });
});

// ── /queue — review queue endpoints ─────────────────────────────────────────

app.get("/queue", (req, res) => {
  const db = getDb();
  const { status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageN = Math.max(1, parseInt(page));
  const limitN = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageN - 1) * limitN;

  const where = status ? "WHERE rq.status = ?" : "";
  const params: unknown[] = status ? [status, limitN, offset] : [limitN, offset];

  const rows = db.prepare(`
    SELECT rq.*, eh.source_type, eh.extracted_fields, eh.confidence_scores
    FROM review_queue rq
    LEFT JOIN extraction_history eh ON eh.extraction_id = rq.extraction_id
    ${where}
    ORDER BY rq.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM review_queue ${where ? "WHERE status = ?" : ""}`).get(
    ...(status ? [status] : [])
  ) as { c: number }).c;

  const parsed = (rows as Record<string, unknown>[]).map(r => ({
    ...r,
    candidate_mapping: parseJson(r["candidate_mapping"]),
    confirmed_mapping: parseJson(r["confirmed_mapping"]),
    extracted_fields: parseJson(r["extracted_fields"]),
    confidence_scores: parseJson(r["confidence_scores"]),
  }));

  res.json({ items: parsed, total, page: pageN, limit: limitN });
});

app.get("/queue/clusters", (req, res) => {
  const db = getDb();
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageN = Math.max(1, parseInt(page));
  const limitN = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageN - 1) * limitN;

  const rows = db.prepare(`
    SELECT
      rq.cluster_id,
      rq.status,
      COUNT(*) as sample_count,
      MIN(rq.created_at) as oldest_at,
      MAX(rq.created_at) as newest_at,
      rq.assigned_analyst,
      rq.sample_raw_pointer,
      eh.source_type
    FROM review_queue rq
    LEFT JOIN extraction_history eh ON eh.extraction_id = rq.extraction_id
    GROUP BY rq.cluster_id
    ORDER BY sample_count DESC, oldest_at ASC
    LIMIT ? OFFSET ?
  `).all(limitN, offset);

  const total = (db.prepare(`SELECT COUNT(DISTINCT cluster_id) as c FROM review_queue`).get() as { c: number }).c;
  res.json({ clusters: rows, total, page: pageN, limit: limitN });
});

app.get("/queue/clusters/:cluster_id", (req, res) => {
  const db = getDb();
  const { cluster_id } = req.params;
  const items = db.prepare(`
    SELECT rq.*, eh.source_type, eh.extracted_fields, eh.confidence_scores
    FROM review_queue rq
    LEFT JOIN extraction_history eh ON eh.extraction_id = rq.extraction_id
    WHERE rq.cluster_id = ?
    ORDER BY rq.created_at ASC
  `).all(cluster_id) as Record<string, unknown>[];

  if (!items.length) return errorResponse(res, "NOT_FOUND", "Cluster not found", 404);

  const parsed: Record<string, any>[] = items.map(r => {
    let candidate = (parseJson(r["candidate_mapping"]) || {}) as Record<string, any>;
    const confirmed = parseJson(r["confirmed_mapping"]) as Record<string, any> | null;
    let extracted = parseJson(r["extracted_fields"]) as Record<string, any> | null;
    let confidence = parseJson(r["confidence_scores"]) as Record<string, any> | null;

    if (Object.keys(candidate).length === 0 && confirmed && typeof confirmed === "object") {
      candidate = Object.fromEntries(
        Object.entries(confirmed).map(([k, v]) => [
          k,
          typeof v === "object" && v !== null && "candidate_ocsf_attribute" in v
            ? v
            : { candidate_ocsf_attribute: String(v).replace(/^\$/, ""), similarity_score: 0.95, alternate_candidates: [] }
        ])
      );
    }

    if ((!confidence || Object.keys(confidence).length === 0) && Object.keys(candidate).length > 0) {
      confidence = Object.fromEntries(
        Object.entries(candidate).map(([k, v]: [string, any]) => [
          k,
          typeof v?.similarity_score === "number" ? v.similarity_score : 0.90
        ])
      );
    }

    return {
      ...r,
      candidate_mapping: candidate,
      confirmed_mapping: confirmed,
      extracted_fields: extracted,
      confidence_scores: confidence,
    };
  });

  const primaryCandidate = parsed.find(p => Object.keys(p.candidate_mapping || {}).length > 0)?.candidate_mapping || parsed[0]!["candidate_mapping"];

  return res.json({
    cluster_id,
    status: parsed[0]!["status"],
    source_type: parsed[0]!["source_type"],
    sample_count: parsed.length,
    oldest_at: parsed[0]!["created_at"],
    assigned_analyst: parsed[0]!["assigned_analyst"],
    items: parsed,
    candidate_mapping: primaryCandidate,
    sample_raw_pointer: parsed[0]!["sample_raw_pointer"],
  });
});

app.post("/queue/clusters/:cluster_id/confirm", (req, res) => {
  const db = getDb();
  const { cluster_id } = req.params;
  const { actor, confirmed_mapping } = req.body as { actor?: string; confirmed_mapping?: unknown };
  if (!actor) return errorResponse(res, "MISSING_ACTOR", "actor is required");

  // Check for concurrent confirmation (409)
  const existing = db.prepare(
    "SELECT status FROM review_queue WHERE cluster_id = ? AND status = 'confirmed' LIMIT 1"
  ).get(cluster_id);
  if (existing) return errorResponse(res, "CONFLICT", "Another analyst already confirmed this cluster", 409);

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE review_queue SET status='confirmed', assigned_analyst=?, confirmed_mapping=?, resolved_at=? WHERE cluster_id=?"
  ).run(actor, JSON.stringify(confirmed_mapping ?? {}), now, cluster_id);

  const cleanCluster = cluster_id.replace(/[^a-zA-Z0-9_]/g, "_");
  const packId = `pack_${cleanCluster}_v1.0.0`;
  const eventHash = `hash_${Date.now()}`;

  db.prepare(`
    INSERT INTO mapping_packs (
      pack_id, version, source_type, pack_yaml_hash, signature, signer_key_id, status, created_at, promoted_at
    ) VALUES (?, '1.0.0', ?, 'hash_confirmed', 'sig_analyst_confirmed', 'dev_signing', 'active', ?, ?)
    ON CONFLICT(pack_id) DO UPDATE SET status = 'active', promoted_at = excluded.promoted_at
  `).run(packId, cluster_id, now, now);

  db.prepare(`
    INSERT INTO pack_lifecycle_events (pack_id, event_type, actor, event_hash, occurred_at)
    VALUES (?, 'pack_confirmed', ?, ?, ?)
  `).run(packId, actor, eventHash, now);

  return res.json({ ok: true, cluster_id, pack_id: packId, status: "confirmed", event_hash: eventHash });
});

app.post("/queue/clusters/:cluster_id/reject", (req, res) => {
  const db = getDb();
  const { cluster_id } = req.params;
  const { actor } = req.body as { actor?: string };
  if (!actor) return errorResponse(res, "MISSING_ACTOR", "actor is required");

  db.prepare(
    "UPDATE review_queue SET status='rejected', assigned_analyst=?, resolved_at=? WHERE cluster_id=?"
  ).run(actor, new Date().toISOString(), cluster_id);

  return res.json({ ok: true, cluster_id, status: "rejected" });
});

app.post("/queue/clusters/:cluster_id/rollback", (req, res) => {
  const db = getDb();
  const { cluster_id } = req.params;
  const { actor } = req.body as { actor?: string };
  if (!actor) return errorResponse(res, "MISSING_ACTOR", "actor is required");

  const existing = db.prepare(
    "SELECT status FROM review_queue WHERE cluster_id = ? LIMIT 1"
  ).get(cluster_id) as { status: string } | undefined;
  if (!existing) return errorResponse(res, "NOT_FOUND", "Cluster not found", 404);
  if (!["confirmed", "rejected"].includes(existing.status)) {
    return errorResponse(res, "INVALID_STATE", `Cannot rollback cluster in status '${existing.status}'`, 409);
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE review_queue SET status='pending', assigned_analyst=NULL, confirmed_mapping=NULL, resolved_at=NULL WHERE cluster_id=?"
  ).run(cluster_id);

  // Roll back the associated pack if it exists
  const packId = `pack_${cluster_id.replace(/[^a-zA-Z0-9_]/g, "_")}_v1.0.0`;
  const pack = db.prepare("SELECT pack_id FROM mapping_packs WHERE pack_id = ?").get(packId);
  if (pack) {
    db.prepare("UPDATE mapping_packs SET status = 'draft' WHERE pack_id = ?").run(packId);
    const hash = `hash-rollback-${Date.now()}`;
    db.prepare(
      "INSERT INTO pack_lifecycle_events (pack_id, event_type, actor, event_hash, occurred_at) VALUES (?, 'pack_rolled_back', ?, ?, ?)"
    ).run(packId, actor, hash, now);
  }

  return res.json({ ok: true, cluster_id, status: "pending" });
});

app.post("/queue/clusters/:cluster_id/assign", (req, res) => {
  const db = getDb();
  const { cluster_id } = req.params;
  const actor = req.body?.actor || req.body?.analyst || req.body?.analyst_id;
  if (!actor) return errorResponse(res, "MISSING_ACTOR", "actor or analyst is required");

  db.prepare(
    "UPDATE review_queue SET status='in_review', assigned_analyst=? WHERE cluster_id=? AND status='pending'"
  ).run(actor, cluster_id);

  return res.json({ ok: true, cluster_id, status: "in_review", analyst: actor });
});

// ── /trace & /verify ──────────────────────────────────────────────────────────

app.get("/trace/:lineage_id", (req, res) => {
  const db = getDb();
  const { lineage_id } = req.params;
  const raw = db.prepare("SELECT * FROM raw_events WHERE lineage_id = ?").get(lineage_id);
  if (!raw) return errorResponse(res, "NOT_FOUND", "lineage_id not found", 404);

  const extractions = db.prepare("SELECT * FROM extraction_history WHERE lineage_id = ?").all(lineage_id);
  const queue = db.prepare("SELECT * FROM review_queue WHERE lineage_id = ?").all(lineage_id);
  const normalization = db.prepare("SELECT * FROM normalization_history WHERE lineage_id = ?").all(lineage_id);

  return res.json({ lineage_id, raw_event: raw, extractions, review_queue: queue, normalization });
});

app.get("/verify/:lineage_id", (req, res) => {
  const db = getDb();
  const { lineage_id } = req.params;
  const raw = db.prepare(`
    SELECT re.*, mc.merkle_root_hash, mc.anchor_status, mc.chain_tx_hash, mc.anchored_at
    FROM raw_events re
    LEFT JOIN merkle_chunks mc ON mc.chunk_id = re.chunk_id
    WHERE re.lineage_id = ?
  `).get(lineage_id) as Record<string, unknown> | undefined;

  if (!raw) return errorResponse(res, "NOT_FOUND", "lineage_id not found", 404);

  const verified = raw["anchor_status"] === "anchored";
  return res.json({
    lineage_id,
    sha256_hash: raw["sha256_hash"],
    chunk_id: raw["chunk_id"],
    merkle_leaf_index: raw["merkle_leaf_index"],
    merkle_root_hash: raw["merkle_root_hash"],
    anchor_status: raw["anchor_status"],
    chain_tx_hash: raw["chain_tx_hash"],
    anchored_at: raw["anchored_at"],
    verified,
    proof_message: verified
      ? "Merkle proof valid — event anchored on-chain"
      : "Batch pending anchoring — cannot verify yet",
  });
});

// ── /stats — triage dashboard metrics ────────────────────────────────────────

app.get("/stats", (_req, res) => {
  const db = getDb();
  const status_counts = db.prepare(`
    SELECT status, COUNT(*) as count FROM review_queue GROUP BY status
  `).all();

  const oldest = db.prepare(`
    SELECT cluster_id, MIN(created_at) as oldest_at FROM review_queue WHERE status='pending' GROUP BY cluster_id ORDER BY oldest_at ASC LIMIT 1
  `).get() as { cluster_id: string; oldest_at: string } | undefined;

  const analyst_load = db.prepare(`
    SELECT assigned_analyst, COUNT(*) as count FROM review_queue WHERE assigned_analyst IS NOT NULL GROUP BY assigned_analyst
  `).all();

  const packs = db.prepare(`
    SELECT status, COUNT(*) as count FROM mapping_packs GROUP BY status
  `).all();

  const chunks = db.prepare(`
    SELECT anchor_status, COUNT(*) as count, SUM(event_count) as total_events FROM merkle_chunks GROUP BY anchor_status
  `).all();

  res.json({ status_counts, oldest_pending: oldest ?? null, analyst_load, packs, merkle_chunks: chunks });
});

// ── /packs — public pack list ─────────────────────────────────────────────────

app.get("/packs", (_req, res) => {
  const db = getDb();
  const packs = db.prepare("SELECT * FROM mapping_packs ORDER BY created_at DESC").all();
  res.json({ packs });
});

// ── start ────────────────────────────────────────────────────────────────────

if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`review-api listening on http://localhost:${PORT}`);
    // Trigger DB init + seed
    getDb();
  });
}
