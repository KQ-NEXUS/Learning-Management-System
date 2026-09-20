"use server";

import { retryExportAction, rerunExportAction } from "../actions";

export async function retryHistoryExportAction(jobId: string) {
  return retryExportAction({ jobId });
}

export async function rerunHistoryExportAction(jobId: string) {
  return rerunExportAction({ jobId });
}
