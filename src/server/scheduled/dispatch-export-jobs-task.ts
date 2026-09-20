type DispatchDependencies = {
  baseUrl: string;
  secret: string;
  fetchImpl: typeof fetch;
};

export function createDispatchExportJobsTask({ baseUrl, secret, fetchImpl }: DispatchDependencies) {
  return async function dispatchExportJobs(): Promise<void> {
    if (!secret || !baseUrl) throw new Error("Export dispatch configuration is missing");
    const deploymentUrl = new URL(baseUrl);
    if (deploymentUrl.protocol !== "https:" || deploymentUrl.username || deploymentUrl.password || deploymentUrl.search || deploymentUrl.hash) {
      throw new Error("Export dispatch deployment URL is invalid");
    }
    const endpoint = new URL("/.netlify/functions/process-export-jobs-background", deploymentUrl.origin);
    const response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-export-dispatch-secret": secret,
      },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status !== 202) throw new Error(`Export dispatch failed with status ${response.status}`);
  };
}

export const runDispatchExportJobsTask = createDispatchExportJobsTask({
  baseUrl: process.env.DEPLOY_PRIME_URL ?? process.env.URL ?? "",
  secret: process.env.EXPORT_DISPATCH_SECRET ?? "",
  fetchImpl: fetch,
});
