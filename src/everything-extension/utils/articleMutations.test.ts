import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { articleMutationsMatter } from "./articleMutations";
import { findQuoteMatch, indexContainer } from "./anchor";

test("sidebar updates do not re-anchor the article, but text and nested DOM edits do", () => {
  const { document } = parseHTML("<html><body><aside>Tick</aside><article><p>Article text</p></article></body></html>");
  const article = document.querySelector("article")!;
  expect(articleMutationsMatter([{ target: document.querySelector("aside")! }], article, article)).toBe(false);
  expect(articleMutationsMatter([{ target: article.firstChild!.firstChild! }], article, article)).toBe(true);
  expect(articleMutationsMatter([{ target: article }], article, article)).toBe(true);
});

test("replacing an article, a main wrapper or the body still requires fresh anchors", () => {
  const { document } = parseHTML("<html><body><main><article>Old</article></main></body></html>");
  const old = document.querySelector("article")!;
  const replacement = document.createElement("article");
  old.replaceWith(replacement);
  expect(articleMutationsMatter([{ target: document.querySelector("main")! }], replacement, old)).toBe(true);
  expect(articleMutationsMatter([{ target: document.documentElement }], document.createElement("body"), document.body)).toBe(true);
});

test("a page using the body as its article still notices every body edit", () => {
  const { document } = parseHTML("<html><body><p>Plain page</p></body></html>");
  expect(articleMutationsMatter([{ target: document.querySelector("p")! }], document.body, document.body)).toBe(true);
});

test("moving the same article under a new wrapper still updates its anchors", () => {
  const { document } = parseHTML("<html><body><article>Article</article><div></div></body></html>");
  const article = document.querySelector("article")!;
  const wrapper = document.querySelector("div")!;
  const observer = new document.defaultView!.MutationObserver(() => {});
  observer.observe(wrapper, { childList: true });
  wrapper.append(article);
  expect(articleMutationsMatter(observer.takeRecords(), article, article)).toBe(true);
  observer.disconnect();
});

test("global stylesheet changes still update the article's theme", () => {
  const { document } = parseHTML("<html><head><style>body{color:black}</style></head><body><aside></aside><article>Article</article></body></html>");
  const article = document.querySelector("article")!;
  expect(articleMutationsMatter([{ target: document.querySelector("style")!.firstChild! }], article, article)).toBe(true);
  const sidebar = document.querySelector("aside")!;
  const bodyStyle = document.createElement("style");
  sidebar.append(bodyStyle);
  expect(articleMutationsMatter([{ target: bodyStyle }], article, article)).toBe(true);
  const observer = new document.defaultView!.MutationObserver(() => {});
  observer.observe(sidebar, { childList: true });
  sidebar.append(document.createElement("style"));
  expect(articleMutationsMatter(observer.takeRecords(), article, article)).toBe(true);
  observer.disconnect();
});

test("indexing preserves raw quote offsets across inline markup, punctuation and case folding", () => {
  const { document } = parseHTML("<article> A—<em>LONG</em> Mixed-Case Kelvin passage 123!<script>skip this</script><span hidden>hidden text</span></article>");
  const index = indexContainer(document.querySelector("article")!);
  expect(index.norm).toBe("a long mixed case kelvin passage 123");
  const match = findQuoteMatch(index, "long mixed case kelvin passage 123")!;
  expect(match.start.node.data.slice(match.start.offset)).toBe("LONG");
  expect(match.end.node.data[match.end.offset]).toBe("3");
  expect(index.normToRaw).toHaveLength(index.norm.length);
});

test("normalization keeps words joined across inline elements and collapses gaps across text nodes", () => {
  const { document } = parseHTML("<article>FO<em>OB</em>AR! <span> </span> 98.<style>skip</style><p>End</p></article>");
  const index = indexContainer(document.querySelector("article")!);
  expect(index.norm).toBe("foobar 98 end");
  expect(index.normToRaw).toEqual([0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15]);
});
