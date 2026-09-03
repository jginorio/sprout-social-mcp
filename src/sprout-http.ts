const RETRY_STATUSES = new Set([429, 500, 503, 504]);

export function parseRetryAfterMs(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: {
    retries?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<Response> {
  const retries = options?.retries ?? 4;
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, init);
    if (response.ok || !RETRY_STATUSES.has(response.status) || attempt === retries) {
      return response;
    }

    const waitMs = parseRetryAfterMs(response.headers.get("retry-after"), attempt);
    lastError = new Error(`Sprout Social API error (${response.status})`);
    await sleep(waitMs);
  }

  throw lastError ?? new Error("Sprout Social API request failed");
}

export function extractCustomerIds(payload: unknown): Array<{ id: string; name?: string }> {
  const data = (payload as { data?: Array<{ customer_id?: string | number; name?: string }> })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => row.customer_id !== undefined && row.customer_id !== null)
    .map((row) => ({ id: String(row.customer_id), name: row.name }));
}
