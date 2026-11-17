import { expect, mock, test } from "bun:test";
import { deliverManualNote } from "./manualNoteDelivery";

test("an unrelated listener's empty reply does not lose a first-page write", async () => {
  let calls = 0;
  const inject = mock(async () => {});
  const opened = await deliverManualNote({
    send: async () => ++calls < 3 ? undefined : { opened: true },
    inject,
    pause: async () => {},
  });
  expect(opened).toBe(true);
  expect(calls).toBe(3);
  expect(inject).not.toHaveBeenCalled();
});

test("a new page gets one injection and retries until its editor is mounted", async () => {
  let calls = 0;
  const inject = mock(async () => {});
  expect(await deliverManualNote({
    send: async () => {
      if (++calls < 3) throw new Error("No receiving end");
      return { opened: true };
    },
    inject,
    pause: async () => {},
  })).toBe(true);
  expect(inject).toHaveBeenCalledTimes(1);
});

test("restricted pages fail without waiting or reporting a successful open", async () => {
  const pause = mock(async () => {});
  expect(await deliverManualNote({
    send: async () => { throw new Error("No receiving end"); },
    inject: async () => { throw new Error("Cannot access this page"); },
    pause,
  })).toBe(false);
  expect(pause).not.toHaveBeenCalled();
});

test("an editor that never becomes ready reports failure after bounded retries", async () => {
  const send = mock(async () => undefined);
  expect(await deliverManualNote({ send, inject: async () => {}, pause: async () => {}, attempts: 3 })).toBe(false);
  expect(send).toHaveBeenCalledTimes(3);
});
