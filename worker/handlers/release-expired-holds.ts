import { releaseExpiredHoldsAsSystem } from "@/server/services/hold-release-system-service";

export type ReleaseExpiredHoldsDeps = {
  releaseExpiredHolds: (
    batchLimit?: number,
  ) => Promise<{ released: number; failed?: number }>;
  log: (message: string) => void;
};

export function createReleaseExpiredHoldsHandler(
  deps: ReleaseExpiredHoldsDeps,
) {
  return async function releaseExpiredHolds(): Promise<void> {
    const result = await deps.releaseExpiredHolds();
    deps.log(`[worker] released ${result.released} expired seat holds`);
  };
}

const built = createReleaseExpiredHoldsHandler({
  releaseExpiredHolds: releaseExpiredHoldsAsSystem,
  log: (message) => console.info(message),
});

export const releaseExpiredHolds = built;
