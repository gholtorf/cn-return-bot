import { describe, expect, test } from "bun:test";
import type { NnnRow, NoteRow } from "@cn/core/types";
import { noteSetOf } from "@cn/features/notes/noteSet";
import { claimGroups, noteCounts } from "./claimGroups";
import { DEFAULT_NOTE_DISPLAY } from "./settings";

// Three Helpful votes rate a note helpful, two Not-helpful votes rate it not
// helpful, and a note without votes needs more ratings (everything-core/noteScore.ts).
const TALLIES = {
  helpful: { helpful_count: 3, somewhat_helpful_count: 0, not_helpful_count: 0 },
  needs_ratings: { helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 0 },
  not_helpful: { helpful_count: 0, somewhat_helpful_count: 0, not_helpful_count: 2 },
};

function note(id: string, claimId: string, status: keyof typeof TALLIES): NoteRow {
  return {
    id,
    claim_id: claimId,
    author_id: null,
    improved_from_note_id: null,
    created_at: "2026-09-29T00:00:00Z",
    claim: { id: claimId },
    ...TALLIES[status],
  } as unknown as NoteRow;
}

const groupsOf = (notes: NoteRow[], display = DEFAULT_NOTE_DISPLAY) => claimGroups(noteSetOf(notes, []), display);

describe("claimGroups", () => {
  test("a claim takes the best status and the most prominent display among its notes", () => {
    const [group] = groupsOf([note("a", "c1", "not_helpful"), note("b", "c1", "helpful")]);
    expect(group!.status).toBe("helpful");
    expect(group!.display).toBe("open");
  });

  test("by default a claim that needs ratings is collapsed and an unhelpful one is a dot", () => {
    const groups = groupsOf([note("a", "c1", "needs_ratings"), note("b", "c1", "not_helpful"), note("c", "c2", "not_helpful")]);
    expect(groups.map((g) => [g.claimId, g.status, g.display])).toEqual([
      ["c1", "needs_ratings", "collapse"],
      ["c2", "not_helpful", "dot"],
    ]);
  });

  test("hidden notes leave their claim, and a claim with only hidden notes disappears", () => {
    const display = { ...DEFAULT_NOTE_DISPLAY, not_helpful: "hide" as const };
    const groups = groupsOf([note("a", "c1", "not_helpful"), note("b", "c2", "not_helpful"), note("c", "c2", "needs_ratings")], display);
    expect(groups.map((g) => g.claimId)).toEqual(["c2"]);
    expect(groups[0]!.notes.map((n) => n.id)).toEqual(["c"]);
  });
});

describe("noteCounts", () => {
  test("status counts ignore the display choices, visible leaves out hidden notes", () => {
    const display = { ...DEFAULT_NOTE_DISPLAY, not_helpful: "hide" as const };
    const notes = [note("a", "c1", "helpful"), note("b", "c1", "needs_ratings"), note("c", "c2", "not_helpful")];
    expect(noteCounts(notes, display)).toEqual({ helpful: 1, needsRatings: 1, notHelpful: 1, visible: 2 });
  });
});

test("grouping preserves first-seen claims, note order, entry ownership and input maps", () => {
  const improvement = { ...note("improvement", "first", "needs_ratings"), improved_from_note_id: "original", created_at: "2026-10-01" };
  const original = { ...note("original", "first", "helpful"), created_at: "2026-11-01" };
  const other = note("other", "second", "not_helpful");
  const hidden = note("hidden", "third", "not_helpful");
  const entries = [
    { id: "b", claim_id: "second" }, { id: "a", claim_id: "first" },
    { id: "c", claim_id: "first" }, { id: "d", claim_id: "third" },
  ] as NnnRow[];
  const set = noteSetOf([improvement, other, original, hidden], entries);
  const result = claimGroups(set, { helpful: "collapse", needs_ratings: "open", not_helpful: "hide" });
  expect(result.map((g) => g.claimId)).toEqual(["first"]);
  expect(result[0]!.claim).toBe(improvement.claim);
  expect(result[0]!.notes.map((n) => n.id)).toEqual(["original", "improvement"]);
  expect(result[0]!.nnn.map((n) => n.id)).toEqual(["a", "c"]);
  expect(result[0]!.status).toBe("helpful");
  expect(result[0]!.display).toBe("open");
  expect([...set.notes.keys()]).toEqual(["improvement", "other", "original", "hidden"]);
  expect([...set.nnn.values()]).toEqual(entries);
  const visible = claimGroups(set, DEFAULT_NOTE_DISPLAY);
  expect(visible.map((g) => g.claimId)).toEqual(["first", "second", "third"]);
  expect(visible[1]!.nnn.map((n) => n.id)).toEqual(["b"]);
  expect(visible[2]!.nnn.map((n) => n.id)).toEqual(["d"]);
});