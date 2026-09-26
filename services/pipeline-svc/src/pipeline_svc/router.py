from uuid import UUID

from ulpf_contracts import ExtractionEnvelope
from ulpf_contracts.generated.extraction_envelope_schema import PathTaken

from .pack_registry import PackRegistry


class Router:
    def __init__(self, registry: PackRegistry) -> None:
        self.registry = registry

    def route_and_extract(self, raw_payload: str | bytes, lineage_id: str | UUID) -> ExtractionEnvelope | None:
        text = raw_payload.decode("utf-8", errors="replace") if isinstance(raw_payload, bytes) else raw_payload

        snapshot = self.registry.snapshot

        for sig in snapshot.signatures:
            m = sig.regex.search(text)
            if m:
                extracted: dict[str, str] = {}
                for k, v in m.groupdict().items():
                    if v is not None:
                        extracted[k] = str(v)

                for field_name, source_expr in sig.extracted_fields.items():
                    if source_expr in extracted:
                        extracted[field_name] = extracted[source_expr]
                    elif source_expr.startswith("$"):
                        group_name = source_expr[1:]
                        if group_name in m.groupdict():
                            val = m.groupdict()[group_name]
                            if val is not None:
                                extracted[field_name] = str(val)
                    else:
                        extracted[field_name] = str(source_expr)

                confidence_scores = {k: 1.0 for k in extracted}
                uid = lineage_id if isinstance(lineage_id, UUID) else UUID(str(lineage_id))

                return ExtractionEnvelope(
                    lineage_id=uid,
                    path_taken=PathTaken.hot,
                    source_type=sig.source_type,
                    parser_version=sig.parser_version,
                    extracted_fields=extracted,
                    confidence_scores=confidence_scores,
                )

        return None
