/** Ranges remain valid when an unrelated part of the page changes. Keep
 * observing the whole document so replacing the article (or body) is noticed. */
type ArticleMutation = Pick<MutationRecord, "target"> & Partial<Pick<MutationRecord, "addedNodes" | "removedNodes">>;

export function articleMutationsMatter(mutations: readonly ArticleMutation[], container: Element, previous: Element | null): boolean {
  if (container !== previous) return true;
  return mutations.some(({ target, addedNodes, removedNodes }) => {
    if (container.contains(target) || container.ownerDocument.head?.contains(target)) return true;
    const targetElement = target.nodeType === 1 ? target as Element : target.parentElement;
    if (targetElement?.closest("style")) return true;
    for (const nodes of [addedNodes, removedNodes]) {
      for (const node of nodes ?? []) {
        // Moving the same article under another wrapper keeps its identity,
        // but can change both its theme and layout. A stylesheet can affect it
        // even when that stylesheet was inserted elsewhere in the body.
        if (node.contains(container)) return true;
        if (node.nodeType === 1) {
          const element = node as Element;
          if (element.matches("style, link") || element.querySelector("style, link")) return true;
        }
      }
    }
    return false;
  });
}
