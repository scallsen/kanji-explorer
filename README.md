# Kanji Explorer

Pick a kanji, see what it is made of, click a radical, see every other kanji
that uses it, keep going. A graph explorer for the 642 kanji taught in
Japanese elementary grades 1–4, built for Daytona HackSprint Tokyo (Sept 2026).

- **Neo4j AuraDB** holds the graph: `(:Kanji)-[:CONTAINS]->(:Radical)` and
  `(:Word)-[:USES]->(:Kanji)`.
- **Daytona** runs every Cypher query inside a sandbox, never from the web
  process. Fixed templates power the main UI; the "Ask AI" tab lets Claude
  write Cypher from a question, which is exactly the kind of untrusted code
  you want sandboxed.
- Dark pixel UI in the style of [Lantern](https://github.com/scallsen/lantern):
  DotGothic16, one accent colour, hard shadows. vis-network for the graph.

## Run it locally

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env       # fill in Neo4j, Anthropic, Daytona keys
set -a; source .env; set +a
.venv/bin/python3 server.py   # http://localhost:5050
```

Rebuilding the data (only needed if you change the scope):

```
scripts/download_data.sh          # kanjidic2, JMdict_e, krad.json into data/raw/
.venv/bin/python3 scripts/prep_data.py    # -> data/kanji.json, radicals.json, words.json
.venv/bin/python3 scripts/load_graph.py   # batched UNWIND load into Neo4j
```

## Deploy

Deployed on Vercel as a single Python serverless function (`api/index.py`
wraps the Flask app; `vercel.json` rewrites every path to it). Set the same
env vars as `.env.example` plus `DAYTONA_SANDBOX_ID` so every cold start
reuses one sandbox instead of creating a new one. Daytona auto-stops idle
sandboxes; the server restarts it on demand (a few seconds on the first
query after a quiet period).

## Layout

| file | what |
|---|---|
| `static/` | the front end: `index.html`, `style.css`, `app.js` (no build step) |
| `server.py` | Flask: `/api/kanji`, `/api/query` (fixed templates), `/ask` (Claude) |
| `query_templates.py` | the Cypher templates behind the structured UI |
| `agent.py` | question → Claude → Cypher → sandbox → answer |
| `sandbox_exec.py` | runs Cypher inside a Daytona sandbox via Neo4j's HTTP Query API |
| `scripts/` | data download, prep, and graph load |
| `data/` | the prepared JSON (642 kanji, 206 radicals, ~13k words) |

## Data sources and attribution

- [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) and
  [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) — property of the
  Electronic Dictionary Research and Development Group (EDRDG), used under
  the [EDRDG licence](https://www.edrdg.org/edrdg/licence.html)
  (CC BY-SA 4.0). The files in `data/` are derived from them.
- [RADKFILE/KRADFILE](https://www.edrdg.org/krad/kradinf.html) (EDRDG) via
  the Unicode conversion in
  [hoffmannjp/krad-unicode](https://github.com/hoffmannjp/krad-unicode).
- [DotGothic16](https://fonts.google.com/specimen/DotGothic16) by Fontworks,
  SIL Open Font License.

## Licence

Code: MIT. Data in `data/`: CC BY-SA 4.0, per the EDRDG licence above.
