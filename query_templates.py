"""Fixed Cypher templates for the structured kanji explorer UI. These run
directly through the Daytona sandbox (sandbox_exec.run_cypher) with no LLM
involved -- the LLM/agent.py path is reserved for the separate free-text
"custom search" box.

Each template declares the `params` it needs (pulled from the request body)
and a `label` shown in the UI. The front end decides how to render rows.
"""

TEMPLATES = {
    # Core flow: "what is this kanji made of"
    "components": {
        "label": "What this kanji is made of",
        "params": ["kanji"],
        "cypher": """
            MATCH (k:Kanji {char: $kanji})-[:CONTAINS]->(r:Radical)
            WHERE r.char <> $kanji
            OPTIONAL MATCH (r)<-[:CONTAINS]-(other:Kanji)
            RETURN r.char AS char, count(DISTINCT other) - 1 AS others
            ORDER BY others DESC
        """,
    },
    # Core flow step 2: click a radical -> every kanji that uses it
    "kanji_by_radical": {
        "label": "Kanji using this radical",
        "params": ["radical"],
        "cypher": """
            MATCH (k:Kanji)-[:CONTAINS]->(r:Radical {char: $radical})
            RETURN k.char AS char, k.meaning AS meaning, k.grade AS grade
            ORDER BY k.grade, k.char
            LIMIT 80
        """,
    },
    "shared_radical": {
        "label": "Kanji sharing a radical",
        "params": ["kanji"],
        "cypher": """
            MATCH (k1:Kanji {char: $kanji})-[:CONTAINS]->(r:Radical)<-[:CONTAINS]-(k2:Kanji)
            WHERE k1 <> k2 AND r.char <> $kanji
            RETURN k2.char AS char, k2.meaning AS meaning, k2.grade AS grade,
                   collect(DISTINCT r.char) AS via, count(DISTINCT r) AS shared
            ORDER BY shared DESC, k2.grade, k2.char
            LIMIT 60
        """,
    },
    "words": {
        "label": "Words using this kanji",
        "params": ["kanji"],
        "cypher": """
            MATCH (w:Word)-[:USES]->(k:Kanji {char: $kanji})
            RETURN w.text AS text, w.meaning AS meaning
            LIMIT 25
        """,
    },
    "next_grade": {
        "label": "Kanji at the next grade level",
        "params": ["kanji"],
        "cypher": """
            MATCH (k:Kanji {char: $kanji})
            WITH k.grade + 1 AS next_grade
            MATCH (k2:Kanji {grade: next_grade})
            RETURN k2.char AS char, k2.meaning AS meaning
            LIMIT 25
        """,
    },
}
