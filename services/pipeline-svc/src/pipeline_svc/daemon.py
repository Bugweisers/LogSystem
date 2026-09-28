"""HTTP daemon and background runner for pipeline-svc."""
import http.server
import json
import os
import sys

PORT = int(os.environ.get("PORT", "8000"))


class HealthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "healthy", "service": "pipeline-svc"}).encode())
        elif self.path.startswith("/raw"):
            from urllib.parse import urlparse, parse_qs
            import re
            from pathlib import Path
            from pipeline_svc.worker import decompress_zstd_bytes

            query = parse_qs(urlparse(self.path).query)
            pointer = query.get("pointer", [None])[0]
            if not pointer:
                self.send_response(400)
                self.end_headers()
                return

            m = re.match(r"^raw_store://([^/]+)/(offset_\d+)$", pointer)
            if not m:
                self.send_response(400)
                self.end_headers()
                return

            chunk_id, offset_key = m.group(1), m.group(2)
            raw_dir = Path("/app/data/raw_store")
            idx_file = raw_dir / f"{chunk_id}.idx.json"
            zst_file = raw_dir / f"{chunk_id}.zst"

            if not idx_file.exists() or not zst_file.exists():
                self.send_response(404)
                self.end_headers()
                return

            try:
                idx_data = json.loads(idx_file.read_text(encoding="utf-8"))
                entry = idx_data.get("entries", {}).get(offset_key)
                if not entry:
                    self.send_response(404)
                    self.end_headers()
                    return

                decomp = decompress_zstd_bytes(zst_file.read_bytes())
                off = int(entry["offset"])
                length = int(entry["length"])
                raw_bytes = decomp[off:off + length]

                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(raw_bytes)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/process":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length > 0 else b"{}"
            try:
                data = json.loads(body.decode("utf-8")) if body else {}
                lineage_ids = data.get("lineage_ids")
                from pipeline_svc.worker import process_events
                res = process_events(lineage_ids=lineage_ids)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(res).encode())
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        pass


def main() -> None:
    print(f"pipeline-svc daemon starting on port {PORT}...")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), HealthHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
