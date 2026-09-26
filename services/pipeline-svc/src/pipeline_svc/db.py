import json
import sqlite3
from datetime import UTC, datetime
from typing import Any

from ulpf_contracts import ExtractionEnvelope


class SqlitePipelineRepository:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._ensure_schema()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _ensure_schema(self) -> None:
        with self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS extraction_history (
                    extraction_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lineage_id TEXT NOT NULL,
                    path_taken TEXT NOT NULL CHECK (path_taken IN ('HOT','COLD')),
                    source_type TEXT NOT NULL,
                    parser_version TEXT NOT NULL,
                    extracted_fields TEXT NOT NULL,
                    confidence_scores TEXT NOT NULL,
                    processed_at TEXT NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS pack_lifecycle_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pack_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    event_hash TEXT NOT NULL,
                    chain_tx_hash TEXT,
                    occurred_at TEXT NOT NULL
                );
            """)

    def record_extraction(self, envelope: ExtractionEnvelope) -> int:
        now = datetime.now(UTC).isoformat()
        path_taken_str = getattr(envelope.path_taken, "value", str(envelope.path_taken))
        lineage_id_str = str(envelope.lineage_id)
        with self._get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO extraction_history (
                    lineage_id, path_taken, source_type, parser_version,
                    extracted_fields, confidence_scores, processed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    lineage_id_str,
                    path_taken_str,
                    envelope.source_type,
                    envelope.parser_version,
                    json.dumps(envelope.extracted_fields),
                    json.dumps(envelope.confidence_scores),
                    now,
                ),
            )
            return cursor.lastrowid or 0

    def get_extractions(self, lineage_id: str) -> list[dict[str, Any]]:
        with self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM extraction_history WHERE lineage_id = ?", (lineage_id,)).fetchall()
            return [dict(r) for r in rows]
