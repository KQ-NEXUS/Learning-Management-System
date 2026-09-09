import { Readable } from "node:stream";
import NodeClam from "clamscan";
import { getLessonObject } from "@/server/services/storage-service";
import {
  findScanTargetAsSystem as findTarget,
  markScanResultAsSystem as markResult,
} from "@/server/services/scan-system-service";

const SCAN_TIMEOUT_MS = 120_000;

type ScanVerdict = {
  isInfected: boolean;
  viruses: string[];
};

type ScanTarget = {
  storageKey: string;
};

type MarkResultInput = {
  id: string;
  status: "CLEAN" | "INFECTED" | "ERROR";
  detail?: string | null;
};

export type ScanLessonResourceDeps = {
  findTarget: (id: string) => Promise<ScanTarget | null>;
  getObject: (key: string) => Promise<Readable>;
  scanStream: (stream: Readable) => Promise<ScanVerdict>;
  markResult: (input: MarkResultInput) => Promise<unknown>;
  timeoutMs?: number;
};

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown scan error.";
  return message.slice(0, 1_000);
}

async function scanWithTimeout(
  stream: Readable,
  scan: (stream: Readable) => Promise<ScanVerdict>,
  timeoutMs: number,
): Promise<ScanVerdict> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      stream.destroy();
      reject(new Error(`ClamAV scan timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([scan(stream), timeoutResult]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createScanLessonResourceHandler(deps: ScanLessonResourceDeps) {
  const timeoutMs = deps.timeoutMs ?? SCAN_TIMEOUT_MS;

  return async function scanLessonResource(lessonResourceId: string): Promise<void> {
    try {
      const target = await deps.findTarget(lessonResourceId);
      if (!target) {
        throw new Error(`Lesson resource ${lessonResourceId} was not found.`);
      }

      const object = await deps.getObject(target.storageKey);
      const result = await scanWithTimeout(object, deps.scanStream, timeoutMs);
      await deps.markResult({
        id: lessonResourceId,
        status: result.isInfected ? "INFECTED" : "CLEAN",
        detail: result.isInfected
          ? result.viruses.join(", ") || "Malware detected"
          : null,
      });
    } catch (error) {
      await deps.markResult({
        id: lessonResourceId,
        status: "ERROR",
        detail: errorDetail(error),
      });
    }
  };
}

let scannerPromise: Promise<NodeClam> | null = null;

function getScanner(): Promise<NodeClam> {
  if (!scannerPromise) {
    const host = process.env.CLAMAV_HOST;
    const port = Number(process.env.CLAMAV_PORT ?? "3310");
    if (!host) {
      throw new Error("CLAMAV_HOST is required to scan lesson resources.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("CLAMAV_PORT must be a valid TCP port.");
    }

    scannerPromise = new NodeClam()
      .init({
        removeInfected: false,
        quarantineInfected: false,
        clamscan: { active: false },
        clamdscan: {
          active: true,
          socket: false,
          host,
          port,
          timeout: SCAN_TIMEOUT_MS,
          localFallback: false,
        },
        preference: "clamdscan",
      })
      .catch((error: unknown) => {
        scannerPromise = null;
        throw error;
      });
  }
  return scannerPromise;
}

const built = createScanLessonResourceHandler({
  findTarget,
  getObject: getLessonObject,
  scanStream: async (stream) => (await getScanner()).scanStream(stream),
  markResult,
});

export const scanLessonResource = built;
