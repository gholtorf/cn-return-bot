import { anchorGroups } from "../../src/everything-extension/utils/anchorGroups";
import { claimGroups, type ClaimGroup } from "../../src/everything-extension/utils/claimGroups";
import type { NoteRow, NnnRow } from "../../src/everything-core/types";
import type { NoteSet } from "../../src/everything-features/notes/noteSet";

const display = { helpful: "open", needs_ratings: "collapse", not_helpful: "dot" } as const;
export function fixture(name: string) {
  const article = document.createElement("article");
  const paragraphs = name.includes("long") ? 1200 : 50;
  const sentence = "A representative mixed-case article paragraph includes numbers 12345, punctuation, café and Kelvin. ";
  article.innerHTML = Array.from({ length: paragraphs }, (_, i) => "<p>" + i + ": " + sentence.repeat(3) + "</p>").join("");
  article.insertAdjacentHTML("afterbegin", '<p>This is the exact passage that the performance fixture explains.</p><img src="https://example.invalid/chart.png">');
  document.body.replaceChildren(article);
  const grouped = name.startsWith("group") || name.startsWith("combined");
  const count = grouped ? (name.includes("large") ? 1000 : 10) : name.startsWith("empty") ? 0 : 1;
  const notes: NoteRow[] = [];
  const nnn: NnnRow[] = [];
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < (grouped ? 3 : 1); j++) notes.push({
      id: i + ":" + j, claim_id: String(i), author_id: null, improved_from_note_id: j ? "original" : null,
      created_at: "2026-11-23T00:00:00Z", helpful_count: j, somewhat_helpful_count: 1, not_helpful_count: 0,
      claim: { id: String(i), updated_quote: null, context_quote: name.includes("image") ? null : "This is the exact passage that the performance fixture explains.", context_paragraph: null, image_urls: name.includes("image") ? ["https://example.invalid/chart.png"] : [] },
    } as unknown as NoteRow);
    nnn.push({ id: String(i), claim_id: String(i) } as NnnRow);
  }
  const set: NoteSet = { notes: new Map(notes.map((n) => [n.id, n])), nnn: new Map(nnn.map((n) => [n.id, n])) };
  const groups: ClaimGroup[] = claimGroups(set, display);
  const run = () => name.startsWith("group") ? claimGroups(set, display).length : anchorGroups(article, name.startsWith("combined") ? claimGroups(set, display) : groups).length;
  if (!name.startsWith("group")) {
    for (const anchored of anchorGroups(article, groups)) {
      if (name.includes("image")) {
        if (!anchored.range.cloneContents().querySelector("img")) throw new Error("Image anchor lost");
      } else if (anchored.range.toString() !== "This is the exact passage that the performance fixture explains") throw new Error("Quote range changed");
    }
  }
  const expected = count;
  if (run() !== expected) throw new Error("Incorrect fixture result: " + name);
  return { run, characters: article.textContent!.length, expected };
}
export function measure(name: string) {
  const { run, characters, expected } = fixture(name);
  for (let i = 0; i < 3; i++) run();
  const times: number[] = [];
  for (let sample = 0; sample < 11; sample++) {
    let calls = 0;
    const started = performance.now();
    do { if (run() !== expected) throw new Error("Result changed"); calls++; } while (performance.now() - started < 30 && calls < 10000);
    times.push((performance.now() - started) / calls);
  }
  return { name, characters, expected, times };
}
