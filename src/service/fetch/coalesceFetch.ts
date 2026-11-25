/** Share overlapping reads of the exact same URL. Completed results (including
 * failures) are never cached. Each endpoint owns a separate instance so page,
 * API, browser and image responses cannot be confused. At capacity a new URL
 * goes straight through: slow reads cannot grow the registry without bound. */
export function coalesceFetch<T>(fetchUrl: (url: string) => Promise<T>, maxPending = 128): (url: string) => Promise<T> {
  if (!Number.isInteger(maxPending) || maxPending < 1) throw new Error("maxPending must be a positive integer");
  const pending = new Map<string, Promise<T>>();
  return (url) => {
    const existing = pending.get(url);
    if (existing) return existing;
    if (pending.size >= maxPending) return fetchUrl(url);
    const result = Promise.resolve().then(() => fetchUrl(url)).finally(() => { pending.delete(url); });
    pending.set(url, result);
    return result;
  };
}
