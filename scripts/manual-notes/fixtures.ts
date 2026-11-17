/** Served only by the local test command; these pages never ship with the site. */
export function startFixtures() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 8010,
    fetch(request) {
      const path = new URL(request.url).pathname;
      const stage = path.includes("processing") ? "processing" : path.includes("queued") ? "queued" : "unchecked";
      const body = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Manual notes local test</title>
<style>body{font:18px/1.6 system-ui;max-width:800px;margin:48px auto;padding:0 24px;color:#182335}nav a{margin-right:20px}aside{padding:20px;background:#eef5ff;border-radius:12px}article{margin:36px 0}h1{line-height:1.2}</style>
<nav><a href="/article">Unchecked page</a><a href="/queued">Bot queued</a><a href="/processing">Bot processing</a><a href="http://127.0.0.1:8003/notes">Local notes website</a></nav>
<h1>Write a note before the bot</h1><aside>This is a private local test. No automated bot is running. Select the passage below, then right-click → <strong>Write a Common Note on this</strong>, or open the extension and choose <strong>Write your own note</strong>. Post a correction and reload to check that it stays saved.</aside>
<article><h2>A sample article</h2><p id="passage">The Moon is made entirely of green cheese.</p><p>This deliberately false statement is here so you can test writing and viewing your own correction. The test page starts ${stage}. Your note should appear without an automated check.</p></article>
<p>Example correction: The Moon is made of rock, not cheese. This is a local test note.</p>
<p>You can post anonymously; no X login or API keys are required. The local email inbox is at <a href="http://127.0.0.1:54324">Mailpit</a>.</p></html>`;
      return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
}

if (import.meta.main) {
  const server = startFixtures();
  console.log(`Manual-note test pages: ${server.url}`);
}
