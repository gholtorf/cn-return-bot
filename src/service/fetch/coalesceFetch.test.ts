import { expect, test } from "bun:test";
import { coalesceFetch } from "./coalesceFetch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("overlapping exact URLs share work; completed results are fetched again", async () => {
  const work = deferred<string>();
  let calls = 0;
  const fetcher = coalesceFetch(async () => { calls++; return work.promise; });
  const first = fetcher("page");
  const second = fetcher("page");
  expect(second).toBe(first);
  work.resolve("fresh");
  expect(await Promise.all([first, second])).toEqual(["fresh", "fresh"]);
  expect(calls).toBe(1);
  await fetcher("page");
  expect(calls).toBe(2);
});

test("distinct URLs and endpoint instances never share results", async () => {
  const a = coalesceFetch(async (url) => "page:" + url);
  const b = coalesceFetch(async (url) => "image:" + url);
  expect(await Promise.all([a("x"), a("y"), b("x")])).toEqual(["page:x", "page:y", "image:x"]);
});

test("failures reach all callers and the next attempt can recover", async () => {
  const work = deferred<string>();
  let calls = 0;
  const fetcher = coalesceFetch(async () => ++calls === 1 ? work.promise : "recovered");
  const first = fetcher("page");
  const second = fetcher("page");
  const outcomes = Promise.allSettled([first, second]);
  work.reject(new Error("upstream unavailable"));
  expect((await outcomes).map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(await fetcher("page")).toBe("recovered");
  expect(calls).toBe(2);
});

test("a synchronous throw is released too", async () => {
  let calls = 0;
  const fetcher = coalesceFetch((): Promise<string> => { if (++calls === 1) throw new Error("failed"); return Promise.resolve("ok"); });
  await expect(fetcher("page")).rejects.toThrow("failed");
  expect(await fetcher("page")).toBe("ok");
});

test("registry saturation passes new URLs through while existing URLs still share", async () => {
  const work = deferred<string>();
  let calls = 0;
  const fetcher = coalesceFetch(async () => { calls++; return work.promise; }, 1);
  const first = fetcher("held");
  const duplicate = fetcher("held");
  const overflow = [fetcher("other"), fetcher("other")];
  work.resolve("ok");
  await Promise.all([first, duplicate, ...overflow]);
  expect(calls).toBe(3);
  expect(() => coalesceFetch(async () => "", 0)).toThrow();
});
