# Kanji Radical Graph Explorer — Build Plan

**Context:** Daytona HackSprint Tokyo, Sept 12 2026. Hacking window: 14:00–16:00 JST (2 hours). Solo build. Must integrate sponsor products: Daytona, Neo4j, Nosana.

## Goal

An agent that answers natural-language questions about kanji ("what other kanji share a radical with 待", "what should I study next after N5") by translating them into Cypher queries, executing them against a Neo4j graph inside a Daytona sandbox. Nosana-generated embeddings enable a semantic ("related in meaning") search layer if time allows.

## Time budget (2 hours total)

| Time | Task |
|---|---|
| 0:00–0:30 | Data prep + Neo4j graph loaded, verified in Neo4j Browser |
| 0:30–1:00 | (Stretch) Nosana embeddings + Neo4j vector index |
| 1:00–1:40 | Agent layer: question → Cypher → Daytona execution → answer |
| 1:40–2:00 | Minimal front end + demo rehearsal |

**If behind schedule, cut in this order:** vector/Nosana embeddings first → front-end polish second → always keep the core question → Cypher → answer loop working end to end with at least one clean demo question.

## Data sources (download locally, do not call live during the demo)

1. **Kanji metadata** (meaning, reading, JLPT level): pre-filtered `kanji_jlpt_only.json`, based on kanjiapi.dev (itself built from KANJIDIC2).
2. **Radical decomposition**: `krad.json` from `hoffmannjp/krad-unicode` on GitHub — a Unicode/JSON conversion of EDRDG's KRADFILE/RADKFILE project. Format: `{"待": ["彳","土","寸"], ...}`.
3. **Words per kanji**: kanjiapi.dev `/v1/words/{char}` endpoint (built from JMdict/EDICT). Call this **once per kanji** in a prep script, write results to a local `words.json`, then never call it live again.

Scope the kanji set to JLPT N5–N3 (~600 kanji) rather than the full ~6,000 — keeps the graph small and the demo fast.

## Graph schema (Neo4j)

```
(:Kanji {char, meaning, jlpt, embedding})
(:Radical {char})
(:Word {text, meaning})

(:Kanji)-[:CONTAINS]->(:Radical)
(:Word)-[:USES]->(:Kanji)
```

Vector index (stretch goal only):
```cypher
CREATE VECTOR INDEX kanji_embeddings IF NOT EXISTS
FOR (k:Kanji) ON (k.embedding)
OPTIONS {indexConfig: {`vector.dimensions`: 384, `vector.similarity_function`: 'cosine'}}
```

## Build steps

1. Create a Neo4j AuraDB Free instance at aura.neo4j.io — save the URI, username, password.
2. Download and filter `kanji_jlpt_only.json` and `krad.json` locally; restrict both to the N5–N3 character set.
3. Write a one-time prep script to fetch `/v1/words/{char}` for each kanji in scope, caching to `words.json`.
4. *(Stretch, only if on schedule)* Spin up a Nosana GPU job to embed each kanji's meaning/example words into a vector; write `embeddings.json`.
5. Write `load_graph.py`: reads the three local JSON files, `MERGE`s Kanji/Radical/Word nodes and CONTAINS/USES relationships into Neo4j (and sets `embedding` if step 4 was done).
6. Verify visually in Neo4j Browser: `MATCH (n) RETURN n LIMIT 50`.
7. Build the agent layer:
   - System prompt describing the schema (node labels, relationship types, properties) so the LLM can write valid Cypher.
   - LLM call: natural-language question → Cypher string.
   - Execute that Cypher **inside a Daytona sandbox** (Python `neo4j` driver + Aura credentials), not directly from the app server.
   - Return the result rows to the LLM, which formats a natural-language answer.
8. Build a minimal front end: one text input, one answer area. Streamlit or a plain HTML page hitting a small backend — no auth, no styling budget.

## Sponsor integration checklist

- [ ] **Neo4j** — graph schema in place; vector index if time allows.
- [ ] **Daytona** — all agent-generated Cypher executes inside a sandbox, never directly from the app.
- [ ] **Nosana** — GPU job generates kanji embeddings (stretch), *or*, as a fallback if short on time, hosts the LLM that generates Cypher instead of an external API.

## Demo script (~2 minutes)

1. Ask a shared-radical question ("what other kanji share a radical with 待") — show the generated Cypher and the answer.
2. Ask a study-path question ("what should I learn next after N5") to show graph traversal reasoning, not just lookup.
3. *(If vectors built)* ask a semantic question ("kanji related to water") to show embedding-based similarity search.
4. Briefly show the live graph in Neo4j Browser.

## Explicit non-goals for this hack

- No user accounts or auth.
- No mobile-responsive styling.
- No handling of the full kanji set — N5–N3 scope only.
- No production error handling — happy path only, for the demo question set.
