# Kanji Radical Graph Explorer — Session Context

Written before a `/compact`, to hand off to continued frontend work. See
also `kanji-graph-plan.md` for the original hackathon plan this followed
(mostly executed as written, with deviations noted below).

## ⚠️ First thing to know: there's a parallel worktree

`git worktree list` shows a second worktree at
`.claude/worktrees/frontend-dummy-data` (branch `worktree-frontend-dummy-data`,
locked), created by a separate agent run (not this session's main thread).
It committed `4acb894 "Add standalone frontend prototype with dummy data"`:
a **fully client-side** `frontend/` app (search + D3-based radical-graph
visualization + a mocked stand-in for the NL agent) driven by
`scripts/generate_dummy_data.py` → `frontend/data.js` — no Flask, Neo4j,
Daytona, or Anthropic API needed to run it.

This session's `static/index.html` uses **vis-network** (CDN) instead of D3,
and is wired to the real backend (`server.py` → Neo4j via Daytona sandbox).
Before doing more frontend work, decide: keep iterating on the real
backend-wired `static/index.html`, adopt ideas/code from the D3 prototype,
or reconcile the two. They are currently divergent, unmerged approaches.

## Repo state

- `master` has one commit (`ad2f47b`, made directly by the user, not by this
  agent) with the *original* Flask + freeform-textbox front end.
- **Uncommitted on master right now**: `sandbox_exec.py` (added `params`
  support), `server.py` (added `/api/kanji`, `/api/templates`, `/api/query`),
  `static/index.html` (rewritten: kanji picker + intent buttons + vis-network
  graph, plus a "Custom search (AI)" section preserving the old freeform
  path), and new untracked `query_templates.py`. Nothing has been committed
  since the initial commit — commit when ready, not automatically.

## Frontend (rebuilt 2026-09-12, dark pixel theme)

`static/index.html` + `static/style.css` + `static/app.js` (vanilla JS, no build
step). Theme borrows lantern's brand package (`scallsen/lantern`, `brand/`):
bg `#1E1E1E`, surface `#313131`, text `#E8E8E8`, one accent `#FF004D`
(selection/primary only), amber `#FFA300`/`#FFEC27` for radicals/readings,
DotGothic16 (Google Fonts) everywhere incl. the hero kanji, hard 4px black
box-shadows, no border radius, `steps()` animations.

Primary flow ("what is this kanji made of"):
1. Search (kanji / meaning / reading, client-side over `/api/kanji`) or browse
   by grade → `selectKanji(char)`.
2. Hero kanji (200px) + meaning/readings, then the equation
   `待 = 土 + 寸 + 彳` from the `components` template. Each radical tile shows
   how many other kanji use it; hover = hint, click = `kanji_by_radical`
   → grid of kanji tiles.
3. Clicking any kanji tile selects it and extends the breadcrumb trail
   (`trail[]`), so users drill 待 › 村 › 木 … indefinitely.

Tabs under the card (Explore graph is the default/first): **Explore graph**
(vis-network; every radical gets its own PICO-8 colour and its edges inherit
it; unexplored nodes have dashed borders; click expands via `components` /
`kanji_by_radical` in batches of 12 with a "+N more" node; hover dims
everything outside the neighbourhood and fills the HUD strip under the
canvas, which has an "open X" button; double-click a kanji node opens it;
graph persists across selections so it mirrors the drill-down trail; auto
re-fits ~1s after each expansion), **Related kanji** (`shared_radical`,
"via" captions), **Words** (`words`), **Ask AI** (unchanged `/ask` path;
kanji found in the rows become clickable tiles). Hovering a radical tile in
the equation also highlights that radical's neighbourhood in the graph. A fixed bottom "console" strip shows the last
template run, sandbox timing, row count, and the Cypher.

`/api/query` now takes `{"intent": key, "params": {...}}`; templates declare
their `params`. `#<kanji>` in the URL hash opens that kanji directly. Query
results are memoised client-side (`cache` Map).

Verified via headless Chrome + puppeteer-core (the Claude-in-Chrome
extension was not connected): screenshots of every flow rendered correctly,
no console errors.

## Architecture

```
Kanji picker + intent buttons  ──POST /api/query──>  server.py ──> query_templates.py (fixed Cypher)
                                                            │
Custom search box (freeform)   ──POST /ask──────────>  server.py ──> agent.py (Claude writes Cypher)
                                                            │
                                                            v
                                                    sandbox_exec.py
                                                            │
                                              Daytona sandbox (reused, id in .sandbox_id)
                                                            │
                                        Neo4j HTTP Query API, https://<host>/db/<user>/query/v2
                                                            │
                                                     Neo4j AuraDB Free
```

Two query paths, by design (user's explicit choice mid-session):
- **Structured path** (`/api/query`): fixed Cypher templates in
  `query_templates.py`, no LLM call. This is the primary UI now (kanji
  picker + buttons + graph viz).
- **Custom search** (`/ask`): original NL→Cypher→answer agent loop in
  `agent.py`, kept as a secondary "AI-generated Cypher" section so the
  Daytona-sandboxed-LLM-agent pitch (the original hackathon angle) still
  has a home in the UI.

Both paths execute Cypher the same way: `sandbox_exec.run_cypher(sandbox,
cypher, params)`, never directly from this process.

## Critical non-obvious facts (would waste time to rediscover)

1. **Daytona's Bolt port (7687) is blocked** on this account's network tier,
   confirmed empirically (raw TCP connect times out) — not a code bug. Fix:
   `sandbox_exec.py` executes Cypher via **Neo4j's HTTP Query API** (plain
   HTTPS POST to `/db/<database>/query/v2`, port 443) instead of the Bolt
   driver. `update_network_settings()` (post-creation) is hard-blocked at
   this tier ("cannot be overridden at sandbox level"); `domain_allow_list`
   **must be set at sandbox creation time** instead.
2. **`domain_allow_list` replaces the default allow-list, not additive.**
   Setting it to just the Neo4j host broke `pip install` (PyPI no longer
   reachable). Must include `pypi.org,files.pythonhosted.org` alongside the
   Neo4j host every time a sandbox is created — see
   `sandbox_exec.get_or_create_sandbox`.
3. **This Aura instance's DB username is the instance ID** (an 8-hex-char id),
   *not* `neo4j` — contrary to the usual Aura default. Verified empirically
   after auth failures; don't "fix" this back to `neo4j`. Same string is
   also the database name in the HTTP Query API path
   (`/db/<instance-id>/query/v2`).
4. **`krad.json`** (from `hoffmannjp/krad-unicode`) is a **list** of
   `{"literal": ..., "components": [...]}`, not the `{char: [radicals]}`
   dict shape the original plan assumed. Already handled correctly in
   `scripts/prep_data.py::parse_krad`.
5. **JMdict_e's `<gloss>` elements do carry `xml:lang="eng"`** explicitly
   (a naive grep for the attribute pattern missed this the first time —
   verified by actually parsing an entry). `prep_data.py` filters on
   `lang in (None, "eng")`.
6. **Sandbox reuse**: one Daytona sandbox is created once and its ID cached
   in `.sandbox_id` (gitignored); reused across all requests/questions to
   avoid multi-second spin-up latency per query. If sandbox creation/config
   changes, delete `.sandbox_id` to force a fresh one.

## Data pipeline (already run, outputs committed)

- Sources: `kanjidic2.xml.gz` + `JMdict_e.gz` (both from EDRDG, direct
  download, no API), `krad.json` (GitHub raw file). All in `data/raw/`
  (gitignored — re-run `scripts/download_data.sh` if needed).
- Scope: kanji with `grade <= 4` (Japanese elementary grades 1–4) → **642
  kanji**. Chosen over the old JLPT scale because kanjidic2's `jlpt` field
  is the *pre-2010* 4-level scale (4=easiest..1=hardest), not modern
  N1–N5 — explicitly not remapped, just avoided as the scoping criterion.
- `scripts/prep_data.py` → `data/kanji.json` (642), `data/radicals.json`
  (642, char → component list), `data/words.json` (642 keys, ≤25 words each,
  common (`ke_pri`-tagged) words preferred when trimming to the cap).
- Loaded into Neo4j via `scripts/load_graph.py` (batched `UNWIND`, not
  row-by-row `MERGE`). Current graph: 642 Kanji, 206 Radical, 12,963 Word
  nodes. Schema: `(:Kanji)-[:CONTAINS]->(:Radical)`,
  `(:Word)-[:USES]->(:Kanji)`.

## Credentials

Live in `.env` (gitignored, never commit): `NEO4J_URI`, `NEO4J_USER`
(= instance ID, see above), `NEO4J_PASSWORD`, `ANTHROPIC_API_KEY`,
`DAYTONA_API_KEY`. `.env.example` has the placeholder shape only.

## Running it

```
source .env && set -a  # or: set -a; source .env; set +a
.venv/bin/python3 server.py   # serves static/index.html + API on :5050
```

`.venv` already has `neo4j`, `anthropic`, `daytona`, `flask`, `requests`
installed (see `requirements.txt`, though `daytona`/`requests` aren't in it
yet — installed ad hoc during debugging, worth adding if the venv is
rebuilt).

## Outstanding / not done

- **Nosana** (embeddings / vector search) — explicitly skipped per the
  plan's own cut order (first thing to cut if short on time). All three
  sponsor integrations are still satisfied without it (Neo4j + Daytona are
  both real and load-bearing; Nosana was always the stretch goal).
- **Frontend**: user said current vis-network structured UI (kanji picker +
  intent buttons + graph) is "closer to what I had in mind" — this is where
  active work continues next, possibly reconciling with the D3 prototype
  worktree mentioned above.
- Never visually verified in a real browser via the Claude-in-Chrome tool
  (extension wasn't connected this session) — only verified via curl/API
  responses, plus one manual screenshot the user provided showing the
  earlier (freeform-textbox) version working correctly.
