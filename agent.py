#!/usr/bin/env python3
"""NL question -> Cypher -> Neo4j -> NL answer.

CLI usage:
    python3 agent.py "what other kanji share a radical with 待"
"""
import json
import os
import re
import sys

import anthropic

import sandbox_exec

MODEL = "claude-sonnet-5"

SCHEMA_PROMPT = """You translate natural-language questions about Japanese kanji into Cypher queries for a Neo4j graph with this schema:

Nodes:
  (:Kanji {char: string, meaning: string, meanings: [string], readings: [string], grade: int, jlpt_old_scale: int or null})
    - grade: Japanese school grade the kanji is taught in (1-4 in this dataset; lower = more elementary)
    - jlpt_old_scale: pre-2010 JLPT level, 4=easiest .. 1=hardest, may be null. Do NOT treat this as the modern N1-N5 scale.
  (:Radical {char: string})
  (:Word {text: string, meaning: string})

Relationships:
  (:Kanji)-[:CONTAINS]->(:Radical)   -- a kanji is composed of a radical
  (:Word)-[:USES]->(:Kanji)          -- a word contains/uses a kanji

Rules:
- Output ONLY a single Cypher query, no prose, wrapped in a ```cypher code block.
- Always LIMIT results to at most 25 rows.
- Prefer returning k.char and k.meaning (or w.text and w.meaning) rather than whole nodes.
- "study next after grade N" means: kanji with grade = N+1 (the next grade up), not a graph traversal on relationships.
- "share a radical with X" means: MATCH (k1:Kanji {char: 'X'})-[:CONTAINS]->(r:Radical)<-[:CONTAINS]-(k2:Kanji) WHERE k1 <> k2.
"""

ANSWER_PROMPT = """You answer a user's question about kanji using the given Cypher query and its result rows. Be concise (2-4 sentences), write kanji characters directly, and mention concrete results (characters/words/meanings) rather than describing the query abstractly. If the result set is empty, say so plainly."""


def extract_cypher(text):
    match = re.search(r"```(?:cypher)?\s*(.*?)```", text, re.DOTALL)
    return (match.group(1) if match else text).strip()


def generate_cypher(client, question, prior_error=None):
    user_msg = f"Question: {question}"
    if prior_error:
        user_msg += (
            f"\n\nYour previous query failed with this Neo4j error:\n{prior_error}\n"
            "Fix the query and try again."
        )
    resp = client.messages.create(
        model=MODEL,
        max_tokens=500,
        system=SCHEMA_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    return extract_cypher(resp.content[0].text)


def run_cypher(sandbox, cypher):
    return sandbox_exec.run_cypher(sandbox, cypher)


def generate_answer(client, question, cypher, rows):
    user_msg = (
        f"Question: {question}\n\nCypher used:\n{cypher}\n\n"
        f"Result rows (JSON):\n{json.dumps(rows, ensure_ascii=False)}"
    )
    resp = client.messages.create(
        model=MODEL,
        max_tokens=400,
        system=ANSWER_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    return resp.content[0].text


def ask(question, sandbox, client, _retried=False):
    cypher = generate_cypher(client, question)
    try:
        rows = run_cypher(sandbox, cypher)
    except Exception as e:
        if _retried:
            raise
        cypher_retry = generate_cypher(client, question, prior_error=str(e))
        rows = run_cypher(sandbox, cypher_retry)
        cypher = cypher_retry
    answer = generate_answer(client, question, cypher, rows)
    return {"question": question, "cypher": cypher, "rows": rows, "answer": answer}


def main():
    question = " ".join(sys.argv[1:]) or "what other kanji share a radical with 待"

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    daytona_client = sandbox_exec.get_daytona_client()
    sandbox = sandbox_exec.get_or_create_sandbox(daytona_client)
    result = ask(question, sandbox, client)

    print(f"Q: {result['question']}\n")
    print(f"Cypher:\n{result['cypher']}\n")
    print(f"Rows: {len(result['rows'])}")
    print(f"\nAnswer: {result['answer']}")


if __name__ == "__main__":
    main()
