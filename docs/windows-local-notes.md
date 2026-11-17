# Manual notes on Windows

This working copy has a separate local test environment. It uses the real
Supabase database, authentication and row permissions in WSL Ubuntu. It does not
run a note bot, call paid AI services, submit to X or write to the hosted database.

## Try it now

Double-click `Test-Manual-Notes.cmd` in the repository root. It starts the local
services and opens an isolated Chrome for Testing window with **Common Notes
(Local Test)** already installed. Your usual browser profile is separate.

1. On the sample article, select “The Moon is made entirely of green cheese.”
2. Right-click and choose **Write a Common Note on this**. Alternatively, open
   the extension from the puzzle-piece toolbar menu and choose **Write your own note**.
3. Write a correction and click **Post note**. An anonymous account is created
   locally; no X login is needed.
4. Click the Common Notes marker beside the passage to open the note. Reload
   the page and open the marker again to verify that it stays saved.
5. Repeat on the **Bot queued** and **Bot processing** sample pages. Posting your
   note neither waits for nor changes those jobs. There is no bot running here.

The marker is collapsed by default for notes that still need ratings. “Draft”
is a rating state: the note is saved and readable immediately, without bot approval.

The test browser can also be used on a real YouTube video. Pause at a passage,
open the extension and choose **Write your own note**, adjust the time range, and
post. Notes go to the local database. The test profile allows YouTube to reach
localhost; on other HTTPS sites, allow local-network access if the browser asks.

## Addresses

| Service | Address |
| --- | --- |
| Sample articles | http://127.0.0.1:8010/article |
| Local notes website | http://127.0.0.1:8003/notes |
| Database Studio | http://127.0.0.1:54323 |
| Local sign-in email inbox | http://127.0.0.1:54324 |

## Commands

Run these from the repository root in PowerShell:

```powershell
# Full setup on this PC (existing WSL Ubuntu required)
.\scripts\manual-notes\local.ps1 -Action Setup

# Start or resume services, preserving your local notes
.\scripts\manual-notes\local.ps1 -Action Start

# Open the preloaded test browser
.\scripts\manual-notes\local.ps1 -Action Browser

# Build both local extension variants after editing source
.\scripts\manual-notes\local.ps1 -Action Build

# Run extension unit tests and browser integration tests
.\scripts\manual-notes\local.ps1 -Action Test

# Show status, or stop the services without deleting data
.\scripts\manual-notes\local.ps1 -Action Status
.\scripts\manual-notes\local.ps1 -Action Stop
```

`Start-Local-Notes.cmd` starts services without opening a browser.
Close the isolated browser window when finished. Local notes persist across restarts.

Setup downloads workspace-local Bun 1.4.4, Supabase CLI 3.2.0, and stable Chrome
for Testing 157.0.8103.78. If a suitable Node.js is unavailable, the browser
commands download Node 24.21.0 locally. Docker Desktop is not required. The
official native Supabase runtime runs inside the existing Ubuntu WSL installation.

## Load into another browser

The local extension has its own name and identity, so it can coexist with the
normal Common Notes extension. Turn the normal extension off while testing the
same page to avoid seeing two sets of notes.

- **Chrome / Edge:** open `chrome://extensions` or `edge://extensions`, turn on
  Developer mode and load `src/everything-extension/.output/chrome-mv3-manual-test`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
  Add-on** and select `src/everything-extension/.output/firefox-mv2-manual-test/manifest.json`.
  This installation lasts until Firefox restarts.

The Chromium browser integration suite tests posting, self-votes, immediate
display and persistence on unchecked, queued and processing pages. It also
exercises timed video notes with real local media on an intercepted YouTube-shaped
page, without fetching YouTube or captions. That fixture is not a live YouTube
compatibility test. Firefox and Edge builds are available for manual testing.

## Environment details

The `manual-test` build mode refuses a non-local Supabase URL. Settings live in
the ignored `.env.manual-test.local` file. Generated configuration, browser
profiles, test screenshots and results live under ignored `.local-test/`.

The local migration runner applies all checked-in migrations once, records
their checksums and stops on errors. It disables cron jobs before committing
each migration so they never dispatch production workflows. A historical
`review_dashboard_annotations.high_value` column, referenced by migration 073
but absent from the checked-in setup migrations, is supplied locally. Concurrent
index builds are ordinary index builds in this private environment so each
migration can run as one transaction. Fixture and verification SQL files are
not applied as migrations. The runner only connects to `127.0.0.1:54322`.

The original `scripts/local-supabase.sh` is a separate Docker-based setup; these
Windows commands do not run it. They do not reset an existing database.
