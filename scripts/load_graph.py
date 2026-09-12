#!/usr/bin/env python3
"""Load data/kanji.json, data/radicals.json, data/words.json into Neo4j
AuraDB. Batches writes with UNWIND instead of one MERGE per row.

Requires env vars: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD.
"""
import json
import os
from pathlib import Path

from neo4j import GraphDatabase

DATA = Path(__file__).parent.parent / "data"
BATCH_SIZE = 500


def batched(rows, size):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def load(session):
    kanji = json.loads(DATA.joinpath("kanji.json").read_text(encoding="utf-8"))
    radicals = json.loads(DATA.joinpath("radicals.json").read_text(encoding="utf-8"))
    words = json.loads(DATA.joinpath("words.json").read_text(encoding="utf-8"))

    print(f"Loading {len(kanji)} Kanji nodes ...")
    for batch in batched(kanji, BATCH_SIZE):
        session.run(
            """
            UNWIND $rows AS row
            MERGE (k:Kanji {char: row.char})
            SET k.meaning = row.meanings[0],
                k.meanings = row.meanings,
                k.readings = row.readings,
                k.grade = row.grade,
                k.jlpt_old_scale = row.jlpt_old_scale
            """,
            rows=batch,
        )

    print("Loading Radical nodes and CONTAINS relationships ...")
    contains_rows = [
        {"char": char, "radical": r}
        for char, rads in radicals.items()
        for r in rads
    ]
    for batch in batched(contains_rows, BATCH_SIZE):
        session.run(
            """
            UNWIND $rows AS row
            MERGE (r:Radical {char: row.radical})
            WITH r, row
            MATCH (k:Kanji {char: row.char})
            MERGE (k)-[:CONTAINS]->(r)
            """,
            rows=batch,
        )

    print("Loading Word nodes and USES relationships ...")
    word_rows = [
        {"char": char, "text": w["text"], "meaning": w["meaning"]}
        for char, entries in words.items()
        for w in entries
    ]
    for batch in batched(word_rows, BATCH_SIZE):
        session.run(
            """
            UNWIND $rows AS row
            MERGE (w:Word {text: row.text})
            SET w.meaning = row.meaning
            WITH w, row
            MATCH (k:Kanji {char: row.char})
            MERGE (w)-[:USES]->(k)
            """,
            rows=batch,
        )

    print("Done.")
    counts = session.run(
        "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY label"
    )
    for record in counts:
        print(f"  {record['label']}: {record['n']}")


def main():
    uri = os.environ["NEO4J_URI"]
    user = os.environ["NEO4J_USER"]
    password = os.environ["NEO4J_PASSWORD"]

    driver = GraphDatabase.driver(uri, auth=(user, password))
    with driver.session() as session:
        load(session)
    driver.close()


if __name__ == "__main__":
    main()
