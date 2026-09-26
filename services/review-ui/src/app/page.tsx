"use client";
import { useEffect, useState, useCallback } from "react";

const API = "http://localhost:4000";

// ─── types ───────────────────────────────────────────────────────────────────
interface Stats {
  status_counts: Array<{ status: string; count: number }>;
  oldest_pending: { cluster_id: string; oldest_at: string } | null;
  analyst_load: Array<{ assigned_analyst: string; count: number }>;
  packs: Array<{ status: string; count: number }>;
  merkle_chunks: Array<{ anchor_status: string; count: number; total_events: number }>;
}

interface Cluster {
  cluster_id: string;
  status: string;
  sample_count: number;
  oldest_at: string;
  newest_at: string;
  assigned_analyst: string | null;
  source_type: string;
  sample_raw_pointer: string;
}

interface QueueItem {
  review_id: number;
  lineage_id: string;
  cluster_id: string;
  status: string;
  source_type: string;
  created_at: string;
  assigned_analyst: string | null;
  candidate_mapping: Record<string, CandidateField>;
  extracted_fields: Record<string, unknown>;
  confidence_scores: Record<string, number>;
  sample_raw_pointer: string;
}

interface CandidateField {
  candidate_ocsf_attribute: string;
  similarity_score: number;
  alternate_candidates?: Array<{ attribute: string; similarity_score: number }>;
}

interface Pack {
  pack_id: string;
  source_type: string;
  version: string;
  status: string;
  created_at: string;
  promoted_at: string | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const label = status.replace("_", " ");
  const icons: Record<string, string> = {
    pending: "⏳", in_review: "🔍", confirmed: "✅", rejected: "❌",
    active: "✅", draft: "📝", staged: "🔄", quarantined: "🚫", deprecated: "📦",
    anchored: "⚓", failed: "❌",
  };
  return (
    <span className={`chip chip-${status}`}>
      {icons[status] ?? "•"} {label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const cls = score >= 0.8 ? "score-high" : score >= 0.6 ? "score-medium" : "score-low";
  return (
    <div className="score-bar-wrap">
      <div className="score-bar">
        <div className={`score-bar-fill ${cls}`} style={{ width: `${Math.round(score * 100)}%` }} />
      </div>
      <span className="score-text">{score.toFixed(2)}</span>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function useFetch<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

// ─── views ───────────────────────────────────────────────────────────────────

function DashboardView() {
  const { data: stats, loading, error } = useFetch<Stats>(`${API}/stats`);
  const { data: clusters } = useFetch<{ clusters: Cluster[] }>(`${API}/queue/clusters`);
  const { data: packs } = useFetch<{ packs: Pack[] }>(`${API}/packs`);

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>;
  if (error) return <div className="banner banner-danger">⚠ {error} — is review-api running on port 4000?</div>;
  if (!stats) return null;

  const counts: Record<string, number> = {};
  for (const { status, count } of stats.status_counts) counts[status] = count;

  const totalEvents = stats.merkle_chunks.reduce((a, c) => a + (c.total_events ?? 0), 0);
  const anchored = stats.merkle_chunks.find(c => c.anchor_status === "anchored");

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Pending Review</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{counts["pending"] ?? 0}</div>
          <div className="stat-sub">clusters awaiting analyst</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">In Review</div>
          <div className="stat-value" style={{ color: "var(--info)" }}>{counts["in_review"] ?? 0}</div>
          <div className="stat-sub">actively being reviewed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Confirmed</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{counts["confirmed"] ?? 0}</div>
          <div className="stat-sub">packs promoted to active</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Events</div>
          <div className="stat-value" style={{ color: "var(--primary-text)" }}>{totalEvents}</div>
          <div className="stat-sub">{anchored?.count ?? 0} chunks anchored</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Packs</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {(packs?.packs ?? []).filter(p => p.status === "active").length}
          </div>
          <div className="stat-sub">of {packs?.packs.length ?? 0} total</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Queue by Status</div>
          {stats.status_counts.map(s => (
            <div key={s.status} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <StatusChip status={s.status} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>{s.count}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Analyst Workload</div>
          {stats.analyst_load.length === 0
            ? <div className="text-muted">No analysts assigned</div>
            : stats.analyst_load.map(a => (
              <div key={a.assigned_analyst} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{a.assigned_analyst}</span>
                <span className="pill pill-blue">{a.count} clusters</span>
              </div>
            ))}
          {stats.oldest_pending && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--warning-dim)", borderRadius: "var(--radius-md)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <div style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600, marginBottom: 4 }}>⚠ OLDEST UNRESOLVED</div>
              <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>{stats.oldest_pending.cluster_id}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(stats.oldest_pending.oldest_at)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="card mt-6">
        <div className="card-title">Recent Clusters</div>
        {clusters && clusters.clusters.slice(0, 5).map(c => (
          <div key={c.cluster_id} style={{ display: "flex", gap: 16, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-accent)" }}>{c.cluster_id}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.source_type} · {c.sample_count} samples · {timeAgo(c.oldest_at)}</div>
            </div>
            <StatusChip status={c.status} />
          </div>
        ))}
      </div>
    </>
  );
}

function QueueView({ onClusterSelect }: { onClusterSelect: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState("");
  const url = `${API}/queue/clusters`;
  const { data, loading, error, reload } = useFetch<{ clusters: Cluster[] }>(url);

  const clusters = (data?.clusters ?? []).filter(c => !statusFilter || c.status === statusFilter);

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["", "pending", "in_review", "confirmed", "rejected"].map(s => (
          <button key={s} className={`btn btn-sm ${statusFilter === s ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setStatusFilter(s)}>
            {s || "All"}
          </button>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={reload} style={{ marginLeft: "auto" }}>↻ Refresh</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40 }}><span className="spinner" /></div>}
      {error && <div className="banner banner-danger">⚠ API unreachable — {error}</div>}

      {!loading && clusters.length === 0 && (
        <div className="empty-state">
          <div className="icon">🎉</div>
          <h3>No clusters pending review</h3>
          <p className="text-muted">All clusters have been processed</p>
        </div>
      )}

      {!loading && clusters.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cluster ID</th>
                <th>Source Type</th>
                <th>Samples</th>
                <th>Status</th>
                <th>Analyst</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map(c => (
                <tr key={c.cluster_id} onClick={() => onClusterSelect(c.cluster_id)}>
                  <td><span className="text-mono" style={{ color: "var(--text-accent)" }}>{c.cluster_id}</span></td>
                  <td><span className="pill pill-blue">{c.source_type ?? "—"}</span></td>
                  <td>{c.sample_count}</td>
                  <td><StatusChip status={c.status} /></td>
                  <td className="text-muted">{c.assigned_analyst ?? "—"}</td>
                  <td className="text-muted">{timeAgo(c.oldest_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ClusterDetail({ clusterId, onBack }: { clusterId: string; onBack: () => void }) {
  const { data, loading, error, reload } = useFetch<{
    cluster_id: string; status: string; source_type: string;
    sample_count: number; oldest_at: string; assigned_analyst: string | null;
    items: QueueItem[]; candidate_mapping: Record<string, CandidateField>;
    sample_raw_pointer: string;
  }>(`${API}/queue/clusters/${clusterId}`);

  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const sampleFields = data ? Object.entries(data.items[0]?.extracted_fields ?? {}) : [];
  const mapping = data?.candidate_mapping ?? {};

  async function handleConfirm() {
    setSubmitting(true); setConflict(false);
    const confirmed = Object.fromEntries(
      Object.entries(mapping).map(([k, v]) => [k, { ...v, candidate_ocsf_attribute: overrides[k] ?? v.candidate_ocsf_attribute }])
    );
    const r = await fetch(`${API}/queue/clusters/${clusterId}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "analyst:jdoe", confirmed_mapping: confirmed }),
    });
    setSubmitting(false);
    if (r.status === 409) { setConflict(true); return; }
    reload();
  }

  async function handleReject() {
    setSubmitting(true);
    await fetch(`${API}/queue/clusters/${clusterId}/reject`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "analyst:jdoe" }),
    });
    setSubmitting(false); reload();
  }

  async function handleAssign() {
    await fetch(`${API}/queue/clusters/${clusterId}/assign`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "analyst:jdoe" }),
    });
    reload();
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>;
  if (error) return <div className="banner banner-danger">⚠ {error}</div>;
  if (!data) return null;

  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={onBack} style={{ marginBottom: 20 }}>← Back to Queue</button>

      {conflict && (
        <div className="banner banner-warning">
          ⚠ <div><strong>409 Conflict</strong> — Another analyst has already confirmed this cluster. Refresh to see the current state.</div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontFamily: "monospace", fontSize: 16, color: "var(--text-accent)", marginBottom: 4 }}>{data.cluster_id}</h2>
          <div className="gap-2">
            <StatusChip status={data.status} />
            <span className="pill pill-blue">{data.source_type}</span>
            <span className="text-muted">{data.sample_count} samples · {timeAgo(data.oldest_at)}</span>
            {data.assigned_analyst && <span className="text-muted">Assigned: {data.assigned_analyst}</span>}
          </div>
        </div>
        <div className="gap-2">
          {data.status === "pending" && (
            <button className="btn btn-secondary" onClick={handleAssign}>👤 Assign to Me</button>
          )}
          {(data.status === "pending" || data.status === "in_review") && (
            <>
              <button className="btn btn-danger" onClick={handleReject} disabled={submitting}>✗ Reject</button>
              <button className="btn btn-primary" onClick={handleConfirm} disabled={submitting}>
                {submitting ? <span className="spinner" /> : "✓ Confirm Mapping"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="detail-pane">
        {/* Left pane: raw sample */}
        <div>
          <div className="section-title">Raw Sample</div>
          <div className="raw-viewer">
            {sampleFields.map(([k, v], i) => (
              <div key={k} className="raw-line">
                <span className="raw-line-num">{i + 1}</span>
                <span className="raw-line-content">
                  <span style={{ color: "var(--text-muted)" }}>{k}</span>
                  <span style={{ color: "var(--border)" }}>=</span>
                  <span style={{ color: "var(--text-primary)" }}>{String(v)}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="section-title">Confidence Scores</div>
            <div className="card" style={{ padding: "12px 14px" }}>
              {Object.entries(data.items[0]?.confidence_scores ?? {}).map(([field, score]) => (
                <div key={field} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="raw-token">{field}</span>
                  <ScoreBar score={score as number} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right pane: field mapping */}
        <div>
          <div className="section-title">Field → OCSF Mapping</div>
          <div className="table-wrap">
            <table className="mapping-table">
              <thead>
                <tr><th>Raw Field</th><th>OCSF Attribute</th><th>Score</th></tr>
              </thead>
              <tbody>
                {Object.entries(mapping).map(([field, info]) => (
                  <tr key={field}>
                    <td><span className="raw-token">{field}</span></td>
                    <td>
                      {(data.status === "pending" || data.status === "in_review") ? (
                        <select
                          value={overrides[field] ?? info.candidate_ocsf_attribute}
                          onChange={e => setOverrides(o => ({ ...o, [field]: e.target.value }))}
                          style={{ background: "var(--bg-elevated)", color: "var(--primary-text)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 8px", fontSize: 12, fontFamily: "monospace", width: "100%" }}
                        >
                          <option value={info.candidate_ocsf_attribute}>{info.candidate_ocsf_attribute}</option>
                          {info.alternate_candidates?.map(c => (
                            <option key={c.attribute} value={c.attribute}>{c.attribute} ({c.similarity_score.toFixed(2)})</option>
                          ))}
                        </select>
                      ) : (
                        <span className="ocsf-attr">{info.candidate_ocsf_attribute}</span>
                      )}
                    </td>
                    <td><ScoreBar score={info.similarity_score} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4" style={{ padding: "10px 14px", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>SAMPLE POINTER</div>
            <div className="text-mono" style={{ color: "var(--text-secondary)" }}>{data.sample_raw_pointer}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function PacksView() {
  const { data, loading } = useFetch<{ packs: Pack[] }>(`${API}/packs`);
  const packs = data?.packs ?? [];

  return (
    <>
      {loading && <div style={{ textAlign: "center", padding: 40 }}><span className="spinner" /></div>}
      {!loading && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Pack ID</th><th>Source Type</th><th>Version</th><th>Status</th><th>Created</th><th>Promoted</th></tr>
            </thead>
            <tbody>
              {packs.map(p => (
                <tr key={p.pack_id}>
                  <td className="text-mono" style={{ color: "var(--text-accent)" }}>{p.pack_id}</td>
                  <td><span className="pill pill-blue">{p.source_type}</span></td>
                  <td className="text-mono">{p.version}</td>
                  <td><StatusChip status={p.status} /></td>
                  <td className="text-muted">{timeAgo(p.created_at)}</td>
                  <td className="text-muted">{p.promoted_at ? timeAgo(p.promoted_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TraceView() {
  const [lineageId, setLineageId] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleTrace() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await fetch(`${API}/trace/${lineageId.trim()}`);
      if (!r.ok) { setError(`Not found (${r.status})`); return; }
      setResult(await r.json());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }

  async function handleVerify() {
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await fetch(`${API}/verify/${lineageId.trim()}`);
      if (!r.ok) { setError(`Not found (${r.status})`); return; }
      setResult(await r.json());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }

  const SAMPLE_IDS = [
    "11111111-0000-4000-a000-000000000001",
    "22222222-0000-4000-a000-000000000001",
    "33333333-0000-4000-a000-000000000001",
    "44444444-0000-4000-a000-000000000001",
  ];

  return (
    <>
      <div className="card mb-4">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={lineageId} onChange={e => setLineageId(e.target.value)}
            placeholder="Enter lineage_id (UUID)…"
            style={{ flex: 1, minWidth: 280, background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontSize: 13, fontFamily: "monospace" }}
          />
          <button className="btn btn-secondary" onClick={handleTrace} disabled={!lineageId || loading}>🔍 Trace</button>
          <button className="btn btn-secondary" onClick={handleVerify} disabled={!lineageId || loading}>⚓ Verify</button>
        </div>
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 8 }}>Quick fill:</span>
          {SAMPLE_IDS.map(id => (
            <button key={id} className="btn btn-sm btn-secondary" style={{ marginRight: 6, marginTop: 4 }}
              onClick={() => setLineageId(id)}>{id.slice(0, 8)}…</button>
          ))}
        </div>
      </div>

      {error && <div className="banner banner-danger">⚠ {error}</div>}
      {loading && <div style={{ textAlign: "center", padding: 30 }}><span className="spinner" /></div>}
      {result && (
        <div className="card">
          <div className="card-title">Result</div>
          <pre style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 500, overflow: "auto" }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

type View = "dashboard" | "queue" | "cluster" | "packs" | "trace";

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API}/health`).then(r => setApiOk(r.ok)).catch(() => setApiOk(false));
  }, []);

  function nav(v: View) { setView(v); setSelectedCluster(null); }

  const pageTitle: Record<View, string> = {
    dashboard: "Triage Dashboard",
    queue: "Review Queue",
    cluster: "Cluster Detail",
    packs: "Mapping Packs",
    trace: "Trace / Verify",
  };
  const pageSub: Record<View, string> = {
    dashboard: "System health and analyst workload overview",
    queue: "Pending clusters awaiting analyst review",
    cluster: "Field-by-field mapping review",
    packs: "Mapping pack registry",
    trace: "Forward trace and Merkle verification",
  };

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">U</div>
          <div>
            <div className="logo-text">ULPF</div>
            <div className="logo-sub">Review Console</div>
          </div>
        </div>

        <div className="nav-section">
          <div className="nav-label">Overview</div>
          <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => nav("dashboard")}>
            <span className="nav-icon">📊</span> Dashboard
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-label">Review</div>
          <button className={`nav-item ${view === "queue" || view === "cluster" ? "active" : ""}`} onClick={() => nav("queue")}>
            <span className="nav-icon">📋</span> Queue
          </button>
          <button className={`nav-item ${view === "packs" ? "active" : ""}`} onClick={() => nav("packs")}>
            <span className="nav-icon">📦</span> Packs
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-label">Audit</div>
          <button className={`nav-item ${view === "trace" ? "active" : ""}`} onClick={() => nav("trace")}>
            <span className="nav-icon">🔍</span> Trace / Verify
          </button>
        </div>

        <div style={{ marginTop: "auto", padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: apiOk === true ? "var(--success)" : apiOk === false ? "var(--danger)" : "var(--text-muted)" }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              API {apiOk === true ? "online" : apiOk === false ? "offline" : "checking…"}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>localhost:4000</div>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <div className="main-header">
          <div>
            <h1>{pageTitle[view]}</h1>
            <div className="sub">{pageSub[view]}</div>
          </div>
          {apiOk === false && (
            <div className="banner banner-warning" style={{ margin: 0, padding: "8px 12px" }}>
              ⚠ API offline — run: <code style={{ fontFamily: "monospace" }}>pnpm dev --filter @ulpf/review-api</code>
            </div>
          )}
        </div>

        <div className="page-content">
          {view === "dashboard" && <DashboardView />}
          {view === "queue" && (
            <QueueView onClusterSelect={id => { setSelectedCluster(id); setView("cluster"); }} />
          )}
          {view === "cluster" && selectedCluster && (
            <ClusterDetail clusterId={selectedCluster} onBack={() => nav("queue")} />
          )}
          {view === "packs" && <PacksView />}
          {view === "trace" && <TraceView />}
        </div>
      </main>
    </div>
  );
}
