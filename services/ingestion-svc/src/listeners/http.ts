import http from "node:http";

export function createHttpListener(options: {
  port: number;
  host?: string;
  onMessage: (msg: Buffer, rinfo: { address: string; port: number }) => Promise<{ lineage_id: string } | void>;
  onError?: (err: Error) => void;
}): { server: http.Server; close: () => Promise<void> } {
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && (req.url === "/ingest" || req.url === "/api/v1/ingest")) {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", async () => {
        const body = Buffer.concat(chunks);
        const rinfo = {
          address: req.socket.remoteAddress || "127.0.0.1",
          port: req.socket.remotePort || 0,
        };
        try {
          const result = await options.onMessage(body, rinfo);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "accepted", ...result }));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "INGESTION_ERROR", message: err.message } }));
        }
      });
    } else if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", service: "ingestion-svc" }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
    }
  });

  if (options.onError) {
    server.on("error", options.onError);
  }

  server.listen(options.port, options.host || "0.0.0.0");

  return {
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
