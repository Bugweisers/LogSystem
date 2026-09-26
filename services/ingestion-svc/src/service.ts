import { join } from "node:path";
import { createIngestionEnvelope } from "./envelope.js";
import { FileSystemRawStore } from "./raw_store.js";
import { SqliteRawEventsRepository } from "./db.js";
import { DiskSpool } from "./spool.js";
import { LocalEventBus } from "./bus.js";
import { DualTriggerBatcher } from "./batcher.js";
import { createUdpListener } from "./listeners/udp.js";
import { createTcpListener } from "./listeners/tcp.js";
import { createHttpListener } from "./listeners/http.js";
import type {
  IngestEnvelope,
  BatcherConfig,
  RawStoreInterface,
  DbRepositoryInterface,
  SpoolInterface,
  BusInterface,
  TransportProtocol,
} from "./types.js";

export interface IngestionServiceOptions {
  dataDir: string;
  dbPath: string;
  batcherConfig?: Partial<BatcherConfig>;
  ports?: {
    udp?: number;
    tcp?: number;
    http?: number;
  };
}

export class IngestionService {
  public rawStore: RawStoreInterface;
  public db: DbRepositoryInterface;
  public spool: SpoolInterface;
  public bus: BusInterface;
  public batcher: DualTriggerBatcher;

  private listeners: { close: () => Promise<void> }[] = [];
  private totalIngested = 0;

  constructor(options: IngestionServiceOptions) {
    const rawStoreDir = join(options.dataDir, "raw_store");
    const spoolDir = join(options.dataDir, "spool");

    this.rawStore = new FileSystemRawStore(rawStoreDir);
    this.db = new SqliteRawEventsRepository(options.dbPath);
    this.spool = new DiskSpool(spoolDir);
    this.bus = new LocalEventBus();

    const config: BatcherConfig = {
      maxEventCount: options.batcherConfig?.maxEventCount ?? 100,
      maxTimeMs: options.batcherConfig?.maxTimeMs ?? 1000,
      maxInlineBytes: options.batcherConfig?.maxInlineBytes ?? 65536,
    };

    this.batcher = new DualTriggerBatcher({
      config,
      rawStore: this.rawStore,
      db: this.db,
      spool: this.spool,
      bus: this.bus,
    });
  }

  async ingest(
    rawBytes: Buffer,
    metadata: {
      source_ip?: string;
      source_port?: number;
      transport_protocol?: TransportProtocol;
    } = {}
  ): Promise<IngestEnvelope> {
    const envelope = createIngestionEnvelope(rawBytes, metadata);
    this.totalIngested++;
    await this.batcher.add(envelope);
    return envelope;
  }

  async startListeners(ports: { udp?: number; tcp?: number; http?: number }): Promise<void> {
    if (ports.udp) {
      const udp = createUdpListener({
        port: ports.udp,
        onMessage: (msg, rinfo) => {
          this.ingest(msg, {
            source_ip: rinfo.address,
            source_port: rinfo.port,
            transport_protocol: "UDP",
          }).catch(console.error);
        },
      });
      this.listeners.push(udp);
    }

    if (ports.tcp) {
      const tcp = createTcpListener({
        port: ports.tcp,
        onMessage: (msg, rinfo) => {
          this.ingest(msg, {
            source_ip: rinfo.address,
            source_port: rinfo.port,
            transport_protocol: "TCP",
          }).catch(console.error);
        },
      });
      this.listeners.push(tcp);
    }

    if (ports.http) {
      const httpListener = createHttpListener({
        port: ports.http,
        onMessage: async (msg, rinfo) => {
          const env = await this.ingest(msg, {
            source_ip: rinfo.address,
            source_port: rinfo.port,
            transport_protocol: "HTTP",
          });
          return { lineage_id: env.lineage_id };
        },
      });
      this.listeners.push(httpListener);
    }
  }

  async flush(): Promise<void> {
    await this.batcher.flush();
  }

  getStats(): { totalIngested: number; pendingBatch: number; pendingSpool: number } {
    return {
      totalIngested: this.totalIngested,
      pendingBatch: this.batcher.getPendingCount(),
      pendingSpool: this.spool.getPendingCount(),
    };
  }

  async close(): Promise<void> {
    await this.flush();
    for (const listener of this.listeners) {
      await listener.close();
    }
    this.listeners = [];
    this.db.close();
  }
}
