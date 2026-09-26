"use client";
import { useEffect, useState, useCallback, useRef, Fragment } from "react";

const API = "http://localhost:4000";

// --- types -------------------------------------------------------------------

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

interface ClustersPage {
  clusters: Cluster[];
  total: number;
  page: number;
  limit: number;
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

interface ClusterDetailData {
  cluster_id: string;
  status: string;
  source_type: string;
  sample_count: number;
  oldest_at: string;
  assigned_analyst: string | null;
  items: QueueItem[];
  candidate_mapping: Record<string, CandidateField>;
  sample_raw_pointer: string;
}

// --- hooks -------------------------------------------------------------------

/** Calls callback on an interval while active=true. */
function useAutoRefresh(callback: () => void, intervalMs: number, active: boolean) {
  const savedCb = useRef(callback);
  useEffect(() => { savedCb.current = callback; });
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => savedCb.current(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}

function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const everLoaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json() as T;
      everLoaded.current = true;
      setData(json);
      setError(null);
      setStale(false);
    } catch (e) {
      setError(String(e));
      if (everLoaded.current) setStale(true);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    everLoaded.current = false;
    setLoading(true);
    setStale(false);
    setError(null);
    load();
  }, [load]);

  return { data, loading, error, stale, reload: load };
}

// --- StatusChip - all 9 states from design.md §2.2 ---------------------------

const STATUS_META: Record<string, { icon: string; label: string }> = {
  pending:     { icon: "\u23F3", label: "Pending" },
  in_review:   { icon: "\uD83D\uDD0D", label: "In Review" },
  confirmed:   { icon: "\u2713", label: "Confirmed" },
  signed:      { icon: "\uD83D\uDD0F", label: "Signed" },
  anchored:    { icon: "\u2693", label: "Anchored" },
  promoted:    { icon: "\uD83D\uDE80", label: "Promoted" },
  rejected:    { icon: "\u2715",  label: "Rejected" },
  quarantined: { icon: "\uD83D\uDEAB", label: "Quarantined" },
  rolled_back: { icon: "\u21A9",  label: "Rolled Back" },
  active:      { icon: "\u25CF",  label: "Active" },
  draft:       { icon: "\uD83D\uDCC4", label: "Draft" },
  staged:      { icon: "\uD83D\uDD04", label: "Staged" },
  deprecated:  { icon: "\uD83D\uDCE6", label: "Deprecated" },
  failed:      { icon: "\u2715",  label: "Failed" },
};

function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { icon: "\u2022", label: status };
  return (
    <span className={`chip chip-${status}`}>
      {meta.icon} {meta.label}
    </span>
  );
}

// --- helpers -----------------------------------------------------------------

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
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// --- Banners -----------------------------------------------------------------

function StalenessBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="banner banner-warning" style={{ marginBottom: 16 }}>
      {"\u26A0"} <div>
        <strong>API unreachable</strong> {"\u2014"} Showing last-known-good cached data (read-only).
        Actions are disabled until the API comes back online.
      </div>
    </div>
  );
}

function ConflictBanner({ show, onDismiss }: { show: boolean; onDismiss: () => void }) {
  if (!show) return null;
  return (
    <div className="banner banner-warning" style={{ marginBottom: 16, cursor: "pointer" }} onClick={onDismiss}>
      {"\u26A0"} <div>
        <strong>409 Conflict</strong> {"\u2014"} Another analyst already confirmed this cluster.
        The view has been refreshed.{" "}
        <span style={{ textDecoration: "underline" }}>Dismiss</span>
      </div>
    </div>
  );
}

function NoActorBanner() {
  return (
    <div className="banner banner-warning" style={{ marginBottom: 16 }}>
      {"\u26A0"} <div>
        <strong>No identity set</strong> {"\u2014"} Enter your analyst name in the sidebar before confirming or rejecting clusters.
      </div>
    </div>
  );
}

// --- RawSampleViewer - up to 5 representative samples (design.md §2.2) --------

function RawSampleViewer({ items, onTrace }: { items: QueueItem[]; onTrace?: (id: string) => void }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const samples = items.slice(0, 5);

  function copy(id: string) {
    if (!id) return;
    try {
      navigator.clipboard?.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore clipboard error
    }
  }

  if (!samples.length) {
    return <div className="raw-viewer" style={{ color: "var(--text-muted)" }}>No samples available</div>;
  }
  return (
    <div>
      {samples.map((item, idx) => {
        const fields = Object.entries(item.extracted_fields ?? {});
        return (
          <div key={item.lineage_id ?? idx} style={{ marginBottom: idx < samples.length - 1 ? 12 : 0 }}>
            <div className="sample-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <span style={{ fontWeight: 600 }}>Sample {idx + 1}</span>
              {item.lineage_id && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <code
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      color: "var(--text-accent)",
                      background: "var(--bg-elevated)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                      userSelect: "all",
                    }}
                    title="Click or copy this full UUID (lineage_id)"
                  >
                    {item.lineage_id}
                  </code>
                  <button
                    className="btn btn-sm btn-secondary"
                    style={{ padding: "1px 6px", fontSize: 10 }}
                    onClick={() => copy(item.lineage_id)}
                    title="Copy full UUID to clipboard"
                  >
                    {copiedId === item.lineage_id ? "\u2713 Copied" : "Copy"}
                  </button>
                  {onTrace && (
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ padding: "1px 6px", fontSize: 10 }}
                      onClick={() => onTrace(item.lineage_id)}
                      title="Open in Trace / Verify screen"
                    >
                      {"\uD83D\uDD0D Trace"}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="raw-viewer">
              {fields.length > 0
                ? fields.map(([k, v], i) => (
                  <div key={k} className="raw-line">
                    <span className="raw-line-num">{i + 1}</span>
                    <span className="raw-line-content">
                      <span style={{ color: "var(--text-muted)" }}>{k}</span>
                      <span style={{ color: "var(--border)" }}>=</span>
                      <span style={{ color: "var(--text-primary)" }}>{String(v)}</span>
                    </span>
                  </div>
                ))
                : (
                  <div className="raw-line">
                    <span className="raw-line-num">1</span>
                    <span className="raw-line-content" style={{ color: "var(--text-primary)" }}>
                      {item.sample_raw_pointer || "(no extracted fields)"}
                    </span>
                  </div>
                )
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- FieldMappingRow - dropdown + free-text escape hatch (design.md §2.2/§2.4) -

interface FieldMappingRowProps {
  field: string;
  info: CandidateField;
  override: string | undefined;
  onChange: (val: string) => void;
  readonly: boolean;
}

function FieldMappingRow({ field, info, override, onChange, readonly }: FieldMappingRowProps) {
  const [customMode, setCustomMode] = useState(false);
  const currentVal = override ?? info.candidate_ocsf_attribute;

  const allCandidates = [
    info.candidate_ocsf_attribute,
    ...(info.alternate_candidates?.map(c => c.attribute) ?? []),
  ];
  const showCustomInput = customMode || (override !== undefined && !allCandidates.includes(override));

  return (
    <tr>
      <td><span className="raw-token">{field}</span></td>
      <td>
        {readonly ? (
          <span className="ocsf-attr">{currentVal}</span>
        ) : showCustomInput ? (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="text"
              value={currentVal}
              onChange={e => onChange(e.target.value)}
              placeholder="OCSF attribute path..."
              autoFocus
              style={{
                flex: 1, background: "var(--bg-base)", color: "var(--text-primary)",
                border: "1px solid var(--primary)", borderRadius: "var(--radius-sm)",
                padding: "4px 8px", fontSize: 12, fontFamily: "monospace",
              }}
            />
            <button
              className="btn btn-sm btn-secondary"
              title="Reset to suggested"
              onClick={() => { setCustomMode(false); onChange(info.candidate_ocsf_attribute); }}
            >{"\u21A9"}</button>
          </div>
        ) : (
          <select
            value={currentVal}
            onChange={e => {
              if (e.target.value === "__custom__") { setCustomMode(true); return; }
              onChange(e.target.value);
            }}
            style={{
              width: "100%", background: "var(--bg-elevated)", color: "var(--primary-text)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              padding: "4px 8px", fontSize: 12, fontFamily: "monospace",
            }}
          >
            <option value={info.candidate_ocsf_attribute}>{info.candidate_ocsf_attribute}</option>
            {info.alternate_candidates?.map(c => (
              <option key={c.attribute} value={c.attribute}>
                {c.attribute} ({c.similarity_score.toFixed(2)})
              </option>
            ))}
            <option value="__custom__">Custom...</option>
          </select>
        )}
      </td>
      <td><ScoreBar score={info.similarity_score} /></td>
    </tr>
  );
}

// --- Universal Log CSV Ingestion Component -----------------------------------

interface IngestResultRecord {
  lineage_id: string;
  sha256_hash: string;
  source_ip?: string;
  source_port?: number;
  transport_protocol?: string;
  raw_size_bytes?: number;
  storage_pointer?: string;
  chunk_id?: string;
  ingestion_timestamp?: string;
  path_taken?: "HOT" | "COLD" | string;
  source_type?: string;
  extracted_fields?: Record<string, unknown>;
  confidence_scores?: Record<string, number>;
  cluster_id?: string;
  review_status?: string;
  ocsf_class_uid?: number;
  schema_valid?: number | boolean;
  sample_preview?: string;
}

interface IngestCsvResponse {
  ok: boolean;
  filename: string;
  total_rows: number;
  ingested_count: number;
  chunks: string[];
  summary: {
    total: number;
    hot_path_count: number;
    cold_path_count: number;
    raw_stored_count: number;
  };
  records: IngestResultRecord[];
}

const SAMPLE_DATASETS: Record<string, { label: string; desc: string; csv: string }> = {
  cisco_asa: {
    label: "\uD83D\uDEE1\uFE0F Cisco ASA Firewall",
    desc: "HOT path firewall deny/permit events matching compiled Cisco ASA pack",
    csv: `timestamp,source_ip,destination_ip,protocol,action,raw_log
2026-09-27T01:00:00Z,192.168.1.105,8.8.8.8,TCP,Deny,<164>Sep 27 2026 01:00:00: %ASA-4-106023: Deny tcp src outside:192.168.1.105/51234 dst inside:8.8.8.8/443 by access-group "acl_outside"
2026-09-27T01:00:05Z,192.168.1.106,1.1.1.1,UDP,Deny,<164>Sep 27 2026 01:00:05: %ASA-4-106023: Deny udp src outside:192.168.1.106/49821 dst inside:1.1.1.1/53 by access-group "acl_outside"
2026-09-27T01:00:10Z,192.168.1.107,8.8.4.4,TCP,Deny,<164>Sep 27 2026 01:00:10: %ASA-4-106023: Deny tcp src outside:192.168.1.107/60122 dst inside:8.8.4.4/80 by access-group "acl_outside"`,
  },
  nginx: {
    label: "\uD83C\uDF10 Nginx Web Access",
    desc: "Web traffic HTTP requests",
    csv: `timestamp,client_ip,status,method,path,raw_log
2026-09-27T01:05:00Z,172.16.0.45,200,GET,/api/v1/health,172.16.0.45 - - [27/Sep/2026:01:05:00 +0000] "GET /api/v1/health HTTP/1.1" 200 64 "-" "curl/7.81.0"
2026-09-27T01:05:02Z,172.16.0.46,404,GET,/admin/login,172.16.0.46 - - [27/Sep/2026:01:05:02 +0000] "GET /admin/login HTTP/1.1" 404 280 "-" "Mozilla/5.0"
2026-09-27T01:05:04Z,172.16.0.47,500,POST,/checkout,172.16.0.47 - - [27/Sep/2026:01:05:04 +0000] "POST /checkout HTTP/1.1" 500 120 "-" "python-requests/2.31"`,
  },
  juniper: {
    label: "\u26A1 Juniper SRX (Cold Path)",
    desc: "Unmapped format demonstrating automatic Drain clustering into Review Queue",
    csv: `timestamp,host,action,raw_log
2026-09-27T01:10:00Z,juniper-gw-01,drop,RT_FLOW: RT_FLOW_SESSION_DENY: session denied 10.20.1.5/45678->198.51.100.1/22 None None 6(0) default:untrust-zone default:trust-zone UNKNOWN UNKNOWN N/A(N/A) ge-0/0/0.0
2026-09-27T01:10:02Z,juniper-gw-01,drop,RT_FLOW: RT_FLOW_SESSION_DENY: session denied 10.20.1.6/45679->198.51.100.2/80 None None 6(0) default:untrust-zone default:trust-zone UNKNOWN UNKNOWN N/A(N/A) ge-0/0/0.0
2026-09-27T01:10:04Z,juniper-gw-02,drop,RT_FLOW: RT_FLOW_SESSION_DENY: session denied 10.20.1.7/45680->198.51.100.3/443 None None 6(0) default:untrust-zone default:trust-zone UNKNOWN UNKNOWN N/A(N/A) ge-0/0/0.0`,
  },
  structured_kv: {
    label: "\uD83D\uDCCA Structured Key-Value CSV",
    desc: "Tabular columns converted to standard universal log event strings",
    csv: `timestamp,src_ip,dst_ip,src_port,dst_port,protocol,action,rule
2026-09-27T01:15:00Z,10.0.5.10,192.0.2.1,51000,443,tcp,deny,block-outbound
2026-09-27T01:15:01Z,10.0.5.11,192.0.2.2,51001,80,tcp,allow,allow-http
2026-09-27T01:15:02Z,10.0.5.12,192.0.2.3,51002,53,udp,deny,block-dns`,
  },
};

function LogCsvUploader({
  onTrace,
  onIngested,
}: {
  onTrace?: (id: string) => void;
  onIngested?: () => void;
}) {
  const [csvText, setCsvText] = useState<string>("");
  const [filename, setFilename] = useState<string>("universal_logs.csv");
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestCsvResponse | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<boolean>(false);
  const [showRawPaste, setShowRawPaste] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse lines for preview
  const rawLines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  const previewRows = rawLines.slice(0, 4);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = evt => {
      const content = String(evt.target?.result ?? "");
      setCsvText(content);
      setError(null);
      setResult(null);
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = evt => {
      const content = String(evt.target?.result ?? "");
      setCsvText(content);
      setError(null);
      setResult(null);
    };
    reader.readAsText(file);
  }

  function loadPreset(key: keyof typeof SAMPLE_DATASETS) {
    const item = SAMPLE_DATASETS[key];
    if (!item) return;
    setFilename(`${key}_sample.csv`);
    setCsvText(item.csv.trim());
    setError(null);
    setResult(null);
  }

  async function handleIngest() {
    if (!csvText.trim()) {
      setError("Please select a CSV file or paste log content first.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/ingest/csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv_content: csvText, filename }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      setResult(data as IngestCsvResponse);
      onIngested?.();
    } catch (err: any) {
      setError(err.message || "Failed to submit logs to Ingestion Layer");
    } finally {
      setUploading(false);
    }
  }

  function copyText(txt: string, id: string) {
    navigator.clipboard?.writeText(txt);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="card mb-6" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>{"\uD83D\uDCE5"}</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              Universal Log Ingestion (CSV / Raw Logs)
            </div>
            <span className="pill pill-blue" style={{ fontSize: 10 }}>C1 Ingestion Layer</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Submit universal CSV security logs to the C1 ingestion batcher, compute authentic SHA-256 cryptographic hashes, write compressed chunks to raw store, and route through the pipeline.
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(SAMPLE_DATASETS).map(([key, item]) => (
            <button
              key={key}
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => loadPreset(key)}
              title={item.desc}
              style={{ fontSize: 11, padding: "4px 8px" }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Drag & Drop Upload Zone */}
      {!result && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "var(--primary)" : "var(--border)"}`,
            borderRadius: "var(--radius-md)",
            padding: "20px 24px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "var(--bg-elevated)" : "var(--bg-base)",
            transition: "all 0.2s",
            marginBottom: 16,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.log"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          <div style={{ fontSize: 24, marginBottom: 6 }}>{"\uD83D\uDCC4"}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {filename && csvText ? `Selected: ${filename}` : "Drag and drop your CSV file here, or click to browse"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Supports standard CSV, headerless syslog lines, firewall events, and web server logs.
          </div>
        </div>
      )}

      {/* Optional raw text toggle / editor */}
      {!result && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setShowRawPaste(!showRawPaste)}
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              {showRawPaste ? "▲ Hide CSV Editor" : "▼ Paste or Edit CSV Raw Text"}
            </button>
            {csvText && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {rawLines.length} lines detected
              </span>
            )}
          </div>

          {showRawPaste && (
            <textarea
              value={csvText}
              onChange={e => { setCsvText(e.target.value); setError(null); setResult(null); }}
              placeholder="Paste comma-separated logs or syslog lines here..."
              rows={6}
              style={{
                width: "100%",
                background: "var(--bg-base)",
                color: "var(--text-primary)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "8px 12px",
                fontSize: 12,
                fontFamily: "monospace",
                resize: "vertical",
              }}
            />
          )}
        </div>
      )}

      {/* Pre-ingest preview */}
      {!result && csvText.trim() && (
        <div style={{ marginBottom: 16, background: "var(--bg-base)", padding: "12px 16px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
              {"\uD83D\uDD0D"} CSV Preview ({rawLines.length} records ready)
            </span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => { setCsvText(""); setResult(null); }}
              style={{ fontSize: 10, padding: "2px 6px" }}
            >
              Clear
            </button>
          </div>
          <div style={{ maxHeight: 110, overflow: "auto", fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
            {previewRows.map((line, idx) => (
              <div key={idx} style={{ padding: "2px 0", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ color: "var(--text-accent)", marginRight: 8 }}>#{idx + 1}</span>
                {line}
              </div>
            ))}
            {rawLines.length > 4 && (
              <div style={{ fontStyle: "italic", marginTop: 4, color: "var(--text-muted)" }}>
                ... and {rawLines.length - 4} more rows
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action button */}
      {!result && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={uploading || !csvText.trim()}
            onClick={handleIngest}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 18px" }}
          >
            {uploading ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14 }} />
                <span>Submitting to Ingestion Layer (:5142)...</span>
              </>
            ) : (
              <>
                <span>{"\uD83D\uDE80"} Submit to Ingestion Layer</span>
              </>
            )}
          </button>
          {csvText && !uploading && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Will write to compressed raw chunks & execute pipeline routing
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="banner banner-danger" style={{ marginTop: 12, fontSize: 12 }}>
          {"\u26A0"} {error}
        </div>
      )}

      {/* Output Display on Dashboard */}
      {result && (
        <div style={{ marginTop: 8 }}>
          <div style={{
            background: "var(--success-dim)",
            border: "1px solid rgba(16,185,129,0.3)",
            borderRadius: "var(--radius-md)",
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--success)", fontWeight: 700, fontSize: 13 }}>
                  {"\u2705"} Ingestion & Ledger Recording Complete
                </span>
                <span className="pill pill-green">{result.ingested_count} logs ingested</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                Stored in raw chunks: <span className="text-mono">{result.chunks.join(", ") || "chunk_active"}</span> {"\u00B7"} All authentic cryptographic SHA-256 hashes verified
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="pill pill-green">HOT Path: {result.summary.hot_path_count}</span>
              <span className="pill pill-yellow">COLD Review Queue: {result.summary.cold_path_count}</span>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => { setResult(null); setCsvText(""); }}
                style={{ fontSize: 11 }}
              >
                + Ingest Another CSV
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Ingested Records & Verification Audit
          </div>

          <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Lineage ID</th>
                  <th>SHA-256 Hash</th>
                  <th>Source / Path</th>
                  <th>Storage Pointer</th>
                  <th>Raw Preview</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {result.records.map((r, i) => (
                  <tr key={r.lineage_id || i}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span className="text-mono" style={{ color: "var(--text-accent)", fontSize: 11 }}>
                          {r.lineage_id ? `${r.lineage_id.slice(0, 8)}...${r.lineage_id.slice(-4)}` : "\u2014"}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => copyText(r.lineage_id, `lid-${i}`)}
                          title="Copy full Lineage ID"
                          style={{ padding: "1px 5px", fontSize: 10 }}
                        >
                          {copiedId === `lid-${i}` ? "\u2713" : "\uD83D\uDCCB"}
                        </button>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span className="text-mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {r.sha256_hash ? `${r.sha256_hash.slice(0, 10)}...` : "\u2014"}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => copyText(r.sha256_hash, `sha-${i}`)}
                          title="Copy SHA-256 Hash"
                          style={{ padding: "1px 5px", fontSize: 10 }}
                        >
                          {copiedId === `sha-${i}` ? "\u2713" : "\uD83D\uDCCB"}
                        </button>
                      </div>
                    </td>
                    <td>
                      {r.path_taken === "HOT" ? (
                        <span className="pill pill-green">HOT: {r.source_type || "matched"}</span>
                      ) : r.path_taken === "COLD" ? (
                        <span className="pill pill-yellow">COLD: {r.cluster_id || "Review Queue"}</span>
                      ) : (
                        <span className="pill pill-blue">RAW STORE</span>
                      )}
                    </td>
                    <td>
                      <span className="text-mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {r.storage_pointer || (r.chunk_id ? `raw_store://${r.chunk_id}` : "\u2014")}
                      </span>
                    </td>
                    <td>
                      <div style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>
                        {r.sample_preview || "\u2014"}
                      </div>
                    </td>
                    <td>
                      {onTrace && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => onTrace(r.lineage_id)}
                          style={{ fontSize: 11, padding: "2px 8px" }}
                        >
                          {"\uD83D\uDD0D"} Trace
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// --- DashboardView -----------------------------------------------------------

function DashboardView({ onTrace }: { onTrace?: (id: string) => void }) {
  const { data: stats, loading, error, stale, reload: reloadStats } = useFetch<Stats>(`${API}/stats`);
  const { data: clustersPage, reload: reloadClusters } = useFetch<ClustersPage>(`${API}/queue/clusters?limit=5`);
  const { data: normData, reload: reloadNorm } = useFetch<{ total: number; items: NormalizedItem[] }>(`${API}/normalized?limit=5`);
  const { data: packs } = useFetch<{ packs: Pack[] }>(`${API}/packs`);

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>;
  if (error && !stale) return <div className="banner banner-danger">{"\u26A0"} {error} {"\u2014"} is review-api running on port 4000?</div>;
  if (!stats) return null;

  const counts: Record<string, number> = {};
  for (const { status, count } of stats.status_counts) counts[status] = count;
  const totalEvents = stats.merkle_chunks.reduce((a, c) => a + (c.total_events ?? 0), 0);
  const anchored = stats.merkle_chunks.find(c => c.anchor_status === "anchored");

  return (
    <>
      <StalenessBanner show={!!stale} />
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
          <div className="stat-label">Normalized Events</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{normData?.total ?? 0}</div>
          <div className="stat-sub">OCSF 4001 Network Activity</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Packs</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>
            {(packs?.packs ?? []).filter(p => p.status === "active").length}
          </div>
          <div className="stat-sub">of {packs?.packs.length ?? 0} total</div>
        </div>
      </div>

      {/* Universal Log CSV Ingestion Layer Studio */}
      <LogCsvUploader onTrace={onTrace} onIngested={() => { reloadStats(); reloadClusters(); reloadNorm(); }} />

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Queue by Status (Cold Path)</div>
          {stats.status_counts.length === 0
            ? <div className="text-muted">No items in queue</div>
            : stats.status_counts.map(s => (
              <div key={s.status} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <StatusChip status={s.status} />
                <span style={{ fontWeight: 700, fontSize: 15 }}>{s.count}</span>
              </div>
            ))
          }
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
            ))
          }
          {stats.oldest_pending && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--warning-dim)", borderRadius: "var(--radius-md)", border: "1px solid rgba(245,158,11,0.2)" }}>
              <div style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600, marginBottom: 4 }}>{"\u26A0"} OLDEST UNRESOLVED</div>
              <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>{stats.oldest_pending.cluster_id}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(stats.oldest_pending.oldest_at)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Normalized OCSF Events */}
      <div className="card mt-6">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title" style={{ margin: 0 }}>Recent Normalized OCSF Events (HOT Path)</div>
          <span className="pill pill-green">{normData?.total ?? 0} Total Normalized</span>
        </div>
        {normData && normData.items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lineage ID</th>
                  <th>OCSF Class</th>
                  <th>Activity</th>
                  <th>Endpoints</th>
                  <th>Source</th>
                  <th>Age</th>
                  <th>Trace</th>
                </tr>
              </thead>
              <tbody>
                {normData.items.slice(0, 5).map(item => {
                  const ocsf = item.ocsf_event;
                  const src = ocsf?.src_endpoint?.ip ? `${ocsf.src_endpoint.ip}:${ocsf.src_endpoint.port || ""}` : (item.source_ip || "\u2014");
                  const dst = ocsf?.dst_endpoint?.ip ? `${ocsf.dst_endpoint.ip}:${ocsf.dst_endpoint.port || ""}` : "\u2014";
                  return (
                    <tr key={item.lineage_id}>
                      <td><span className="text-mono" style={{ color: "var(--text-accent)", fontSize: 11 }}>{item.lineage_id.slice(0, 8)}...</span></td>
                      <td><span className="pill pill-green">OCSF {item.ocsf_class_uid}</span></td>
                      <td><strong>{ocsf?.activity_name || "Traffic"}</strong></td>
                      <td><span className="text-mono" style={{ fontSize: 11 }}>{src} {"\u2192"} {dst}</span></td>
                      <td><span className="pill pill-blue">{item.source_type || "hot-path"}</span></td>
                      <td className="text-muted">{timeAgo(item.normalized_at)}</td>
                      <td>
                        {onTrace && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => onTrace(item.lineage_id)}
                            style={{ fontSize: 10, padding: "2px 6px" }}
                          >
                            {"\uD83D\uDD0D"} Trace
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-muted">No normalized events yet</div>
        )}
      </div>

      <div className="card mt-6">
        <div className="card-title">Recent Clusters (Cold Path Awaiting Review)</div>
        {clustersPage && clustersPage.clusters.length > 0
          ? clustersPage.clusters.map(c => (
            <div key={c.cluster_id} style={{ display: "flex", gap: 16, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-accent)" }}>{c.cluster_id}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.source_type ?? "unknown"} {"\u00B7"} {c.sample_count} samples {"\u00B7"} {timeAgo(c.oldest_at)}</div>
              </div>
              <StatusChip status={c.status} />
            </div>
          ))
          : <div className="text-muted">No clusters yet</div>
        }
      </div>
    </>
  );
}

// --- QueueView - paginated, status-filtered, auto-refreshed ------------------

function QueueView({ onClusterSelect }: { onClusterSelect: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const url = `${API}/queue/clusters?page=${page}&limit=${LIMIT}`;
  const { data, loading, error, stale, reload } = useFetch<ClustersPage>(url);

  // Auto-refresh queue every 10s (design.md §2.3)
  useAutoRefresh(reload, 10000, true);

  const clusters = (data?.clusters ?? []).filter(c => !statusFilter || c.status === statusFilter);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <>
      <StalenessBanner show={!!stale} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["", "pending", "in_review", "confirmed", "rejected"].map(s => (
          <button
            key={s}
            id={`queue-filter-${s || "all"}`}
            className={`btn btn-sm ${statusFilter === s ? "btn-primary" : "btn-secondary"}`}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s ? s.replace("_", " ") : "All"}
          </button>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={reload} style={{ marginLeft: "auto" }}>{"\u21BB"} Refresh</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40 }}><span className="spinner" /></div>}
      {error && !stale && <div className="banner banner-danger">{"\u26A0"} API unreachable {"\u2014"} {error}</div>}

      {!loading && clusters.length === 0 && (
        <div className="empty-state">
          <div className="icon">{"\uD83C\uDF89"}</div>
          <h3>No clusters pending review</h3>
          <p className="text-muted">
            {statusFilter ? `No clusters with status "${statusFilter}"` : "All clusters have been processed"}
          </p>
        </div>
      )}

      {clusters.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cluster ID</th><th>Source Type</th><th>Samples</th>
                  <th>Status</th><th>Analyst</th><th>Age</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map(c => (
                  <tr key={c.cluster_id} onClick={() => onClusterSelect(c.cluster_id)} style={{ cursor: "pointer" }}>
                    <td><span className="text-mono" style={{ color: "var(--text-accent)" }}>{c.cluster_id}</span></td>
                    <td><span className="pill pill-blue">{c.source_type ?? "\u2014"}</span></td>
                    <td>{c.sample_count}</td>
                    <td><StatusChip status={c.status} /></td>
                    <td className="text-muted">{c.assigned_analyst ?? "\u2014"}</td>
                    <td className="text-muted">{timeAgo(c.oldest_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{"\u2190"} Prev</button>
              <span className="text-muted">Page {page} of {totalPages} {"\u00B7"} {total} total</span>
              <button className="btn btn-sm btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next {"\u2192"}</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// --- ClusterDetail - 3s polling, free-text override, rollback -----------------

function ClusterDetail({ clusterId, onBack, actor, onTrace }: { clusterId: string; onBack: () => void; actor: string; onTrace?: (id: string) => void }) {
  const { data, loading, error, stale, reload } = useFetch<ClusterDetailData>(
    `${API}/queue/clusters/${clusterId}`
  );
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // 3s auto-poll while status is transitional (design.md §2.3)
  const transitional = !!data?.status && ["pending", "in_review", "confirmed", "signed"].includes(data.status);
  useAutoRefresh(reload, 3000, transitional && !stale);

  const mapping = data?.candidate_mapping ?? {};
  const isReadonly = !data || !["pending", "in_review"].includes(data.status);
  const canAct = !!actor && !isReadonly && !stale && !submitting;

  // Confidence scores fallback: from items[0].confidence_scores or candidate_mapping similarity
  const confidenceScores: Record<string, number> = {};
  if (data?.items?.[0]?.confidence_scores && Object.keys(data.items[0].confidence_scores).length > 0) {
    Object.assign(confidenceScores, data.items[0].confidence_scores);
  } else if (mapping && Object.keys(mapping).length > 0) {
    for (const [k, v] of Object.entries(mapping)) {
      if (typeof v?.similarity_score === "number") {
        confidenceScores[k] = v.similarity_score;
      }
    }
  }

  async function handleConfirm() {
    if (!actor) return;
    setSubmitting(true); setConflict(false);
    const confirmed = Object.fromEntries(
      Object.entries(mapping).map(([k, v]) => [k, { ...v, candidate_ocsf_attribute: overrides[k] ?? v.candidate_ocsf_attribute }])
    );
    const r = await fetch(`${API}/queue/clusters/${clusterId}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor, confirmed_mapping: confirmed }),
    });
    setSubmitting(false);
    if (r.status === 409) { setConflict(true); reload(); return; }
    reload();
  }

  async function handleReject() {
    if (!actor) return;
    setSubmitting(true);
    await fetch(`${API}/queue/clusters/${clusterId}/reject`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor }),
    });
    setSubmitting(false); reload();
  }

  async function handleAssign() {
    if (!actor) return;
    await fetch(`${API}/queue/clusters/${clusterId}/assign`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor }),
    });
    reload();
  }

  async function handleRollback() {
    if (!actor) return;
    setSubmitting(true);
    await fetch(`${API}/queue/clusters/${clusterId}/rollback`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor }),
    });
    setSubmitting(false); reload();
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>;
  if (error && !stale) return <div className="banner banner-danger">{"\u26A0"} {error}</div>;
  if (!data) return null;

  return (
    <>
      <button id="cluster-back-btn" className="btn btn-secondary btn-sm" onClick={onBack} style={{ marginBottom: 20 }}>
        {"\u2190"} Back to Queue
      </button>

      <ConflictBanner show={conflict} onDismiss={() => setConflict(false)} />
      <StalenessBanner show={!!stale} />
      {!actor && <NoActorBanner />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontFamily: "monospace", fontSize: 16, color: "var(--text-accent)", marginBottom: 6 }}>{data.cluster_id}</h2>
          <div className="gap-2">
            <StatusChip status={data.status} />
            {data.source_type && <span className="pill pill-blue">{data.source_type}</span>}
            <span className="text-muted">{data.sample_count} samples {"\u00B7"} {timeAgo(data.oldest_at)}</span>
            {data.assigned_analyst && <span className="text-muted">Assigned: {data.assigned_analyst}</span>}
            {transitional && !stale && <span className="poll-indicator">{"\u25CF"} live</span>}
          </div>
        </div>
        <div className="gap-2" style={{ flexWrap: "wrap" }}>
          {data.status === "pending" && (
            <button id="cluster-assign-btn" className="btn btn-secondary" onClick={handleAssign} disabled={!actor || !!stale}>
              {"\uD83D\uDC64"} Assign to Me
            </button>
          )}
          {(data.status === "pending" || data.status === "in_review") && (
            <>
              <button id="cluster-reject-btn" className="btn btn-danger" onClick={handleReject} disabled={!canAct}>
                {"\u2715"} Reject
              </button>
              <button id="cluster-confirm-btn" className="btn btn-primary" onClick={handleConfirm} disabled={!canAct}>
                {submitting ? <span className="spinner" /> : "\u2713 Confirm Mapping"}
              </button>
            </>
          )}
          {(data.status === "confirmed" || data.status === "rejected") && (
            <button id="cluster-rollback-btn" className="btn btn-secondary" onClick={handleRollback} disabled={!actor || !!stale || submitting}>
              {"\u21A9"} Rollback
            </button>
          )}
        </div>
      </div>

      <div className="detail-pane">
        {/* Left: up to 5 raw samples + confidence scores */}
        <div>
          <div className="section-title">Raw Samples {"\u2014"} {Math.min(data.items.length, 5)} of {data.items.length}</div>
          <RawSampleViewer items={data.items} onTrace={onTrace} />
          <div className="mt-4">
            <div className="section-title">Confidence Scores</div>
            <div className="card" style={{ padding: "12px 14px" }}>
              {Object.entries(confidenceScores).map(([field, score]) => (
                <div key={field} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="raw-token">{field}</span>
                  <ScoreBar score={score as number} />
                </div>
              ))}
              {Object.keys(confidenceScores).length === 0 && (
                <div className="text-muted">No confidence scores available</div>
              )}
            </div>
          </div>
        </div>

        {/* Right: field -> OCSF mapping with free-text override */}
        <div>
          <div className="section-title">Field {"\u2192"} OCSF Mapping</div>
          <div className="table-wrap">
            <table className="mapping-table">
              <thead>
                <tr><th>Raw Field</th><th>OCSF Attribute</th><th>Score</th></tr>
              </thead>
              <tbody>
                {Object.entries(mapping).map(([field, info]) => (
                  <FieldMappingRow
                    key={field}
                    field={field}
                    info={info}
                    override={overrides[field]}
                    onChange={val => setOverrides(o => ({ ...o, [field]: val }))}
                    readonly={isReadonly}
                  />
                ))}
                {Object.keys(mapping).length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)", padding: 20 }}>
                      No mapping candidates available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card mt-4">
            <div className="section-title" style={{ marginBottom: 6 }}>Sample Pointer</div>
            <div className="text-mono" style={{ color: "var(--text-secondary)" }}>{data.sample_raw_pointer || "\u2014"}</div>
          </div>
        </div>
      </div>
    </>
  );
}

// --- PacksView ---------------------------------------------------------------

function PacksView() {
  const { data, loading, error, stale, reload } = useFetch<{ packs: Pack[] }>(`${API}/packs`);
  const [filter, setFilter] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  async function handleRollback(pack: Pack) {
    if (!confirm(`Rollback pack ${pack.pack_id}? Status will become quarantined.`)) return;
    setActing(pack.pack_id);
    await fetch(`${API}/packs/${pack.pack_id}/rollback`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "analyst:review_ui" }),
    });
    setActing(null); reload();
  }

  const packs = (data?.packs ?? []).filter(p => !filter || p.status === filter);

  return (
    <>
      <StalenessBanner show={!!stale} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["", "active", "quarantined", "draft", "staged"].map(s => (
          <button
            key={s}
            id={`packs-filter-${s || "all"}`}
            className={`btn btn-sm ${filter === s ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setFilter(s)}
          >
            {s ? s.replace("_", " ") : "All"}
          </button>
        ))}
        <button className="btn btn-sm btn-secondary" onClick={reload} style={{ marginLeft: "auto" }}>{"\u21BB"} Refresh</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40 }}><span className="spinner" /></div>}
      {error && !stale && <div className="banner banner-danger">{"\u26A0"} {error}</div>}

      {!loading && packs.length === 0 && (
        <div className="empty-state">
          <div className="icon">{"\uD83D\uDCE6"}</div>
          <h3>No mapping packs found</h3>
          <p className="text-muted">{filter ? `No packs with status "${filter}"` : "No packs registered"}</p>
        </div>
      )}

      {packs.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pack ID</th><th>Source Type</th><th>Version</th>
                <th>Status</th><th>Created</th><th>Promoted</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {packs.map(p => (
                <tr key={p.pack_id}>
                  <td><span className="text-mono" style={{ color: "var(--text-accent)" }}>{p.pack_id}</span></td>
                  <td><span className="pill pill-blue">{p.source_type}</span></td>
                  <td><span className="text-mono">{p.version}</span></td>
                  <td><StatusChip status={p.status} /></td>
                  <td className="text-muted">{timeAgo(p.created_at)}</td>
                  <td className="text-muted">{p.promoted_at ? timeAgo(p.promoted_at) : "\u2014"}</td>
                  <td>
                    {p.status === "active" && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleRollback(p)}
                        disabled={acting === p.pack_id}
                        title="Rollback pack to quarantined"
                      >
                        {acting === p.pack_id ? <span className="spinner" /> : "\u21A9 Rollback"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// --- TraceView ---------------------------------------------------------------

function TraceView({ initialLineageId }: { initialLineageId?: string }) {
  const [lineageId, setLineageId] = useState(initialLineageId ?? "");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"trace" | "verify" | null>(null);

  const doRequest = useCallback(async (endpoint: string, m: "trace" | "verify", targetId?: string) => {
    const id = (targetId ?? lineageId).trim();
    if (!id) return;
    setLoading(true); setError(""); setResult(null); setMode(m);
    try {
      const r = await fetch(`${API}/${endpoint}/${id}`);
      if (!r.ok) { setError(`HTTP ${r.status} \u2014 lineage_id not found`); return; }
      setResult(await r.json());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [lineageId]);

  useEffect(() => {
    if (initialLineageId) {
      setLineageId(initialLineageId);
      doRequest("trace", "trace", initialLineageId);
    }
  }, [initialLineageId, doRequest]);

  const verifyResult = mode === "verify" && result !== null && typeof result === "object"
    ? result as { verified: boolean; proof_message?: string }
    : null;

  return (
    <>
      <div className="card mb-4">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            id="trace-input"
            value={lineageId}
            onChange={e => setLineageId(e.target.value)}
            onKeyDown={e => e.key === "Enter" && lineageId && doRequest("trace", "trace")}
            placeholder="Enter lineage_id (UUID)..."
            style={{
              flex: 1, minWidth: 280, background: "var(--bg-elevated)", color: "var(--text-primary)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
              padding: "8px 12px", fontSize: 13, fontFamily: "monospace",
            }}
          />
          <button id="trace-btn" className="btn btn-secondary" onClick={() => doRequest("trace", "trace")} disabled={!lineageId || loading}>{"\uD83D\uDD0D"} Trace</button>
          <button id="verify-btn" className="btn btn-secondary" onClick={() => doRequest("verify", "verify")} disabled={!lineageId || loading}>{"\u2693"} Verify</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
          <strong>Trace</strong> {"\u2014"} forward pipeline trace from ingestion to OCSF output. &nbsp;
          <strong>Verify</strong> {"\u2014"} Merkle proof and anchor status for a specific event.
        </div>
      </div>

      {error && <div className="banner banner-danger">{"\u26A0"} {error}</div>}
      {loading && <div style={{ textAlign: "center", padding: 30 }}><span className="spinner" /></div>}

      {result && (
        <div className="card">
          <div className="card-title">
            {mode === "verify" ? "\u2693 Merkle Verification" : "\uD83D\uDD0D Forward Trace"}
          </div>
          {verifyResult && (
            <div className={verifyResult.verified ? "verify-ok" : "verify-warn"}>
              {verifyResult.verified
                ? "\u2713 Merkle proof valid \u2014 event anchored"
                : `\u23F3 ${verifyResult.proof_message ?? "Batch pending anchoring \u2014 cannot verify yet"}`}
            </div>
          )}
          <pre style={{
            fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)",
            whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 500, overflow: "auto",
          }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}

// --- NormalizedView - live stream of normalized OCSF 4001 logs ----------------

interface NormalizedItem {
  normalization_id: number;
  lineage_id: string;
  extraction_id: number;
  ocsf_class_uid: number;
  ocsf_event_json: string;
  schema_valid: number;
  normalized_at: string;
  source_ip?: string;
  transport_protocol?: string;
  storage_pointer?: string;
  source_type?: string;
  path_taken?: string;
  ocsf_event?: Record<string, any>;
}

function NormalizedView({ onTrace }: { onTrace: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, loading, error, stale, reload } = useFetch<{ total: number; items: NormalizedItem[]; page?: number; limit?: number }>(
    `${API}/normalized?page=${page}&limit=${limit}`
  );
  useAutoRefresh(reload, 5000, true);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const items = (data?.items ?? []).filter(item => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      item.lineage_id.toLowerCase().includes(s) ||
      (item.source_type || "").toLowerCase().includes(s) ||
      (item.ocsf_event?.activity_name || "").toLowerCase().includes(s) ||
      (item.ocsf_event?.src_endpoint?.ip || "").includes(s) ||
      (item.ocsf_event?.dst_endpoint?.ip || "").includes(s)
    );
  });

  return (
    <>
      <StalenessBanner show={!!stale} />
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Filter by lineage ID, source, IP, or activity..."
          style={{
            flex: 1, minWidth: 260,
            background: "var(--bg-elevated)", color: "var(--text-primary)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            padding: "6px 12px", fontSize: 13,
          }}
        />
        <select
          value={limit}
          onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
          style={{
            background: "var(--bg-elevated)", color: "var(--text-primary)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            padding: "6px 10px", fontSize: 12,
          }}
        >
          <option value={10}>Show 10</option>
          <option value={25}>Show 25</option>
          <option value={50}>Show 50</option>
          <option value={100}>Show 100</option>
          <option value={200}>Show 200</option>
        </select>
        <button className="btn btn-sm btn-secondary" onClick={reload}>{"\u21BB"} Refresh</button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40 }}><span className="spinner" /></div>}
      {error && !stale && <div className="banner banner-danger">{"\u26A0"} {error}</div>}

      {!loading && items.length === 0 && (
        <div className="empty-state">
          <div className="icon">{"\u26A1"}</div>
          <h3>No normalized events found</h3>
          <p className="text-muted">
            Events matching active mapping packs (e.g. Cisco ASA) or confirmed clusters appear here automatically.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lineage ID</th>
                  <th>OCSF Class</th>
                  <th>Activity</th>
                  <th>Endpoints (Src {"\u2192"} Dst)</th>
                  <th>Schema</th>
                  <th>Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  let ocsf = item.ocsf_event;
                  if (!ocsf || typeof ocsf !== "object") {
                    try {
                      ocsf = typeof item.ocsf_event_json === "string" ? JSON.parse(item.ocsf_event_json) : item.ocsf_event_json;
                      if (typeof ocsf === "string") ocsf = JSON.parse(ocsf);
                    } catch {
                      ocsf = {};
                    }
                  }
                  ocsf = ocsf || {};

                  const isExpanded = expandedId === item.lineage_id;
                  const src = ocsf?.src_endpoint?.ip ? `${ocsf.src_endpoint.ip}${ocsf.src_endpoint.port ? `:${ocsf.src_endpoint.port}` : ""}` : (item.source_ip || "\u2014");
                  const dst = ocsf?.dst_endpoint?.ip ? `${ocsf.dst_endpoint.ip}${ocsf.dst_endpoint.port ? `:${ocsf.dst_endpoint.port}` : ""}` : "\u2014";
                  const method = ocsf?.http_request?.http_method || "";
                  const path = ocsf?.http_request?.url?.path || "";
                  const statusCode = ocsf?.http_response?.code;

                  return (
                    <Fragment key={item.lineage_id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : item.lineage_id)}
                        style={{ cursor: "pointer", transition: "background 0.15s" }}
                        className={isExpanded ? "row-selected" : ""}
                      >
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                            <span className="text-mono" style={{ color: "var(--text-accent)", fontSize: 12 }}>
                              {item.lineage_id.slice(0, 8)}...{item.lineage_id.slice(-4)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="pill pill-green">
                            {ocsf?.class_name ? `${ocsf.class_name} (${item.ocsf_class_uid})` : `Class ${item.ocsf_class_uid}`}
                          </span>
                        </td>
                        <td>
                          {method ? (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <span className="pill pill-blue" style={{ fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>{method}</span>
                              <span className="text-mono" style={{ fontSize: 11 }}>{path || ocsf?.activity_name || "Traffic"}</span>
                            </span>
                          ) : (
                            <span style={{ fontWeight: 600 }}>{ocsf?.activity_name || "Traffic"}</span>
                          )}
                        </td>
                        <td>
                          <span className="text-mono" style={{ fontSize: 11 }}>
                            {src} {dst !== "\u2014" ? `\u2192 ${dst}` : ""}
                          </span>
                        </td>
                        <td>
                          <span className={`pill ${item.schema_valid ? "pill-green" : "pill-red"}`}>
                            {statusCode ? `${statusCode} \u00B7 Valid OCSF` : item.schema_valid ? "Valid OCSF" : "Invalid"}
                          </span>
                        </td>
                        <td className="text-muted" style={{ fontSize: 11 }}>
                          {timeAgo(item.normalized_at)}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className={`btn btn-sm ${isExpanded ? "btn-primary" : "btn-secondary"}`}
                              onClick={() => setExpandedId(isExpanded ? null : item.lineage_id)}
                              style={{ fontSize: 10, padding: "2px 6px" }}
                            >
                              {isExpanded ? "Close" : "Inspect"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => onTrace(item.lineage_id)}
                              style={{ fontSize: 10, padding: "2px 6px" }}
                            >
                              {"\uD83D\uDD0D"} Trace
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--bg-surface)", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
                              <div style={{ background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Client Endpoint</div>
                                <div className="text-mono" style={{ fontSize: 12, color: "var(--text-accent)", marginTop: 2 }}>{src}</div>
                              </div>
                              {method && (
                                <div style={{ background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>HTTP Request</div>
                                  <div className="text-mono" style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 2 }}>{method} {path}</div>
                                </div>
                              )}
                              {statusCode && (
                                <div style={{ background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>HTTP Response</div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--success)", marginTop: 2 }}>Status {statusCode}</div>
                                </div>
                              )}
                              {ocsf?.traffic?.bytes_out !== undefined && (
                                <div style={{ background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Response Payload</div>
                                  <div className="text-mono" style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 2 }}>{ocsf.traffic.bytes_out} bytes</div>
                                </div>
                              )}
                              {ocsf?.time && (
                                <div style={{ background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Log Event Time</div>
                                  <div className="text-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{ocsf.time}</div>
                                </div>
                              )}
                            </div>

                            {ocsf?.http_request?.user_agent && (
                              <div style={{ background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)", marginBottom: 14 }}>
                                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>User Agent</div>
                                <div className="text-mono" style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{ocsf.http_request.user_agent}</div>
                              </div>
                            )}

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)" }}>
                                Complete Normalized OCSF 1.2.0 JSON Event:
                              </span>
                              <span className="text-mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                pointer: {item.storage_pointer || "\u2014"}
                              </span>
                            </div>

                            <pre style={{
                              background: "var(--bg-elevated)",
                              padding: 12, borderRadius: "var(--radius-sm)",
                              fontSize: 11, fontFamily: "monospace", overflow: "auto", maxHeight: 240, margin: 0,
                              color: "var(--text-primary)", border: "1px solid var(--border-subtle)", lineHeight: 1.4
                            }}>
                              {JSON.stringify(ocsf, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-sm btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                {"\u2190"} Prev
              </button>
              <span className="text-muted">
                Page {page} of {totalPages} {"\u00B7"} {total} total
              </span>
              <button
                className="btn btn-sm btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next {"\u2192"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// --- AnalystInput - sidebar identity widget (design.md §5, §2.4) --------------

function AnalystInput({ actor, onChange }: { actor: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(actor);

  useEffect(() => {
    setDraft(actor);
    setEditing(!actor);
  }, [actor]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setEditing(false);
  }

  return (
    <div className="analyst-section">
      <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        Analyst Identity
      </div>
      {editing ? (
        <div style={{ display: "flex", gap: 4 }}>
          <input
            id="analyst-name-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === "Enter" && commit()}
            placeholder="your-name..."
            style={{
              flex: 1, background: "var(--bg-elevated)", color: "var(--text-primary)",
              border: "1px solid var(--primary)", borderRadius: "var(--radius-sm)",
              padding: "5px 8px", fontSize: 12,
            }}
          />
          <button id="analyst-save-btn" className="btn btn-sm btn-primary" disabled={!draft.trim()} onClick={commit}>{"\u2713"}</button>
        </div>
      ) : (
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" }}
          onClick={() => { setDraft(actor); setEditing(true); }}
          title="Click to change identity"
        >
          <div className="analyst-avatar">{(actor || "?").slice(0, 1).toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{actor || "Not set"}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>click to change</div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main App -----------------------------------------------------------------

type View = "dashboard" | "queue" | "cluster" | "packs" | "trace" | "normalized";

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [activeTraceId, setActiveTraceId] = useState<string>("");
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  // Analyst identity - persisted to localStorage (design.md §5: never anonymous)
  const [actor, setActor] = useState<string>("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("ulpf_actor");
      if (stored) setActor(stored);
    } catch {
      // ignore
    }
  }, []);

  function setActorPersisted(v: string) {
    setActor(v);
    try {
      if (typeof window !== "undefined") localStorage.setItem("ulpf_actor", v);
    } catch {
      // ignore
    }
  }

  // API health check every 5s
  useEffect(() => {
    const check = () => fetch(`${API}/health`).then(r => setApiOk(r.ok)).catch(() => setApiOk(false));
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  function nav(v: View) { setView(v); setSelectedCluster(null); }
  function handleTrace(id: string) { setActiveTraceId(id); setView("trace"); setSelectedCluster(null); }

  const pageTitle: Record<View, string> = {
    dashboard: "Triage Dashboard",
    queue: "Review Queue",
    cluster: "Cluster Detail & Auto-Onboarding",
    packs: "Mapping Packs",
    trace: "Trace / Verify",
    normalized: "Normalized OCSF Logs",
  };
  const pageSub: Record<View, string> = {
    dashboard: "System health and analyst workload overview",
    queue: "Clusters awaiting analyst review \u2014 sorted by volume",
    cluster: "Field-by-field candidate mapping review and confirmation",
    packs: "Mapping pack registry \u2014 all statuses",
    trace: "Forward trace and Merkle anchor verification by lineage_id",
    normalized: "Live stream of hot-path parsed and OCSF 4001 normalized security events",
  };

  return (
    <div className="layout">
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
          <button id="nav-dashboard" className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => nav("dashboard")}>
            <span className="nav-icon">{"\uD83D\uDCCA"}</span> Dashboard
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-label">Review</div>
          <button id="nav-queue" className={`nav-item ${view === "queue" || view === "cluster" ? "active" : ""}`} onClick={() => nav("queue")}>
            <span className="nav-icon">{"\uD83D\uDCCB"}</span> Queue
          </button>
          <button id="nav-packs" className={`nav-item ${view === "packs" ? "active" : ""}`} onClick={() => nav("packs")}>
            <span className="nav-icon">{"\uD83D\uDCE6"}</span> Packs
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-label">Audit & Streams</div>
          <button id="nav-normalized" className={`nav-item ${view === "normalized" ? "active" : ""}`} onClick={() => nav("normalized")}>
            <span className="nav-icon">{"\u26A1"}</span> Normalized Logs
          </button>
          <button id="nav-trace" className={`nav-item ${view === "trace" ? "active" : ""}`} onClick={() => nav("trace")}>
            <span className="nav-icon">{"\uD83D\uDD0D"}</span> Trace / Verify
          </button>
        </div>

        <div style={{ padding: "8px 12px", marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: apiOk === true ? "var(--success)" : apiOk === false ? "var(--danger)" : "var(--text-muted)",
              boxShadow: apiOk === true ? "0 0 6px var(--success)" : "none",
              transition: "all 0.3s",
            }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              API {apiOk === true ? "online" : apiOk === false ? "offline" : "checking..."}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>localhost:4000</div>
        </div>

        <AnalystInput actor={actor} onChange={setActorPersisted} />
      </aside>

      <main className="main">
        <div className="main-header">
          <div>
            <h1>{pageTitle[view]}</h1>
            <div className="sub">{pageSub[view]}</div>
          </div>
          {apiOk === false && (
            <div className="banner banner-warning" style={{ margin: 0, padding: "8px 12px", fontSize: 12 }}>
              {"\u26A0"} API offline {"\u2014"} run: <code style={{ fontFamily: "monospace" }}>pnpm --filter @ulpf/review-api dev</code>
            </div>
          )}
        </div>

        <div className="page-content">
          {view === "dashboard" && <DashboardView onTrace={handleTrace} />}
          {view === "queue" && (
            <QueueView onClusterSelect={id => { setSelectedCluster(id); setView("cluster"); }} />
          )}
          {view === "cluster" && selectedCluster && (
            <ClusterDetail clusterId={selectedCluster} onBack={() => nav("queue")} actor={actor} onTrace={handleTrace} />
          )}
          {view === "packs" && <PacksView />}
          {view === "normalized" && <NormalizedView onTrace={handleTrace} />}
          {view === "trace" && <TraceView initialLineageId={activeTraceId} />}
        </div>
      </main>
    </div>
  );
}
