"""
ULPF Pipeline Worker Script.
Processes unextracted or specified lineage events through the Router,
OCSF Normalization engine, and Cold-Path Drain/SemanticMapper/ConfidenceGate.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "services" / "pipeline-svc" / "src"))
sys.path.insert(0, str(REPO_ROOT / "packages" / "contracts" / "python"))

from pipeline_svc.coldpath.confidence_gate import ConfidenceGate
from pipeline_svc.coldpath.drain import DrainParser
from pipeline_svc.coldpath.semantic_mapper import SemanticMapper
from pipeline_svc.db import SqlitePipelineRepository
from pipeline_svc.normalization import normalize_and_record
from pipeline_svc.pack_registry import PackRegistry
from pipeline_svc.router import Router


def process_events(lineage_ids: list[str] | None = None, db_path: str = "ulpf.db") -> dict[str, Any]:
    db_file = REPO_ROOT / db_path
    pub_key_path = REPO_ROOT / "keys" / "dev_signing.pub"
    pub_key = pub_key_path.read_bytes() if pub_key_path.exists() else b""

    registry = PackRegistry(public_key_pem=pub_key)
    registry.reconcile_sweep(REPO_ROOT / "packs")

    drain_parser = DrainParser()
    semantic_mapper = SemanticMapper()
    confidence_gate = ConfidenceGate(db_path=str(db_file), threshold=0.85)

    router = Router(
        registry=registry,
        drain_parser=drain_parser,
        semantic_mapper=semantic_mapper,
        confidence_gate=confidence_gate,
    )

    repo = SqlitePipelineRepository(str(db_file))

    class LocalBus:
        def __init__(self) -> None:
            self.events: list[tuple[str, dict[str, Any]]] = []

        def publish(self, topic: str, msg: dict[str, Any]) -> None:
            self.events.append((topic, msg))

    bus = LocalBus()

    conn = sqlite3.connect(str(db_file))
    conn.row_factory = sqlite3.Row

    if lineage_ids:
        placeholders = ",".join("?" for _ in lineage_ids)
        query = f"SELECT * FROM raw_events WHERE lineage_id IN ({placeholders})"
        rows = conn.execute(query, lineage_ids).fetchall()
    else:
        # Process any events in raw_events that do not have an extraction_history record yet
        query = """
            SELECT re.* FROM raw_events re
            LEFT JOIN extraction_history eh ON eh.lineage_id = re.lineage_id
            WHERE eh.extraction_id IS NULL
            ORDER BY re.created_at ASC
            LIMIT 200
        """
        rows = conn.execute(query).fetchall()

    results: list[dict[str, Any]] = []

    for row in rows:
        lid = row["lineage_id"]
        # Raw log bytes: try to read from chunk store or construct from metadata
        chunk_id = row["chunk_id"]
        storage_ptr = row["storage_pointer"]
        leaf_idx = row["merkle_leaf_index"]

        raw_text = ""
        offset_key = f"offset_{leaf_idx}"
        idx_file = REPO_ROOT / "data" / "raw_store" / f"{chunk_id}.idx.json"
        zst_file = REPO_ROOT / "data" / "raw_store" / f"{chunk_id}.zst"
        if idx_file.exists() and zst_file.exists():
            try:
                import zstandard as zstd
                idx_data = json.loads(idx_file.read_text(encoding="utf-8"))
                entry = idx_data.get("entries", {}).get(offset_key)
                if entry:
                    dctx = zstd.ZstdDecompressor()
                    decomp = dctx.decompress(zst_file.read_bytes())
                    off = int(entry["offset"])
                    length = int(entry["length"])
                    raw_text = decomp[off:off + length].decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001, S110
                pass

        # Fallback raw text if chunk wasn't readable
        if not raw_text:
            raw_text = f"source_ip={row['source_ip']} port={row['source_port']} proto={row['transport_protocol']}"

        envelope = router.route_and_extract(raw_text, lid, enable_cold_path=True)

        if envelope:
            ext_id = repo.record_extraction(envelope)
            path_taken = getattr(envelope.path_taken, "value", str(envelope.path_taken))

            # If hot path, normalize to OCSF
            if path_taken.upper() == "HOT":
                try:
                    norm_res, _ = normalize_and_record(
                        envelope,
                        extraction_id=ext_id,
                        repo=repo,
                        bus=bus,  # type: ignore[arg-type]
                        raw_data_ptr=storage_ptr,
                    )
                    results.append({
                        "lineage_id": lid,
                        "path_taken": "HOT",
                        "source_type": envelope.source_type,
                        "normalized": norm_res.schema_valid,
                        "ocsf_class": norm_res.ocsf_event.class_uid if norm_res.ocsf_event else None,
                    })
                except Exception as ex:  # noqa: BLE001
                    results.append({
                        "lineage_id": lid,
                        "path_taken": "HOT",
                        "source_type": envelope.source_type,
                        "error": str(ex),
                    })
            else:
                # Cold path: Drain cluster or review queue
                results.append({
                    "lineage_id": lid,
                    "path_taken": "COLD",
                    "source_type": envelope.source_type,
                    "fields_extracted": len(envelope.extracted_fields),
                })
        else:
            results.append({
                "lineage_id": lid,
                "path_taken": "RAW",
                "source_type": "unknown",
            })

    conn.close()
    return {"processed_count": len(results), "items": results}


def main() -> None:
    parser = argparse.ArgumentParser(description="ULPF Pipeline Worker")
    parser.add_argument("--lineage-ids", nargs="*", help="List of lineage IDs to process")
    parser.add_argument("--db-path", default="ulpf.db", help="Path to ulpf.db")
    args = parser.parse_args()

    res = process_events(args.lineage_ids, args.db_path)
    print(json.dumps(res))


if __name__ == "__main__":
    main()
