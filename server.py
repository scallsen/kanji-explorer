#!/usr/bin/env python3
"""Minimal backend for the demo front end: one POST /ask endpoint.
Reuses a single Anthropic client and a single Daytona sandbox across
requests (created once at startup) instead of per-question.
"""
import json
import os
import textwrap
import time

import anthropic
from flask import Flask, jsonify, request, send_from_directory

import agent
import sandbox_exec
from query_templates import TEMPLATES

app = Flask(__name__, static_folder="static", static_url_path="")

with open(os.path.join(os.path.dirname(__file__), "data", "kanji.json"), encoding="utf-8") as f:
    KANJI_LIST = json.load(f)

_client = None
_sandbox = None


def get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def get_sandbox():
    global _sandbox
    if _sandbox is None:
        daytona_client = sandbox_exec.get_daytona_client()
        _sandbox = sandbox_exec.get_or_create_sandbox(daytona_client)
    return _sandbox


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/kanji")
def kanji_list():
    return jsonify(KANJI_LIST)


@app.route("/api/templates")
def templates():
    return jsonify({key: {"label": t["label"], "params": t["params"]} for key, t in TEMPLATES.items()})


@app.route("/api/query", methods=["POST"])
def query():
    """Runs one fixed template. Body: {"intent": <template key>, "params": {...}}.
    Also accepts the older flat form {"intent": ..., "kanji": "..."}."""
    body = request.get_json(silent=True) or {}
    intent = body.get("intent")
    template = TEMPLATES.get(intent)
    if not template:
        return jsonify({"error": "a valid intent is required"}), 400
    supplied = dict(body.get("params") or {})
    for name in template["params"]:
        if name in body and name not in supplied:
            supplied[name] = body[name]
    params = {name: (str(supplied.get(name) or "")).strip() for name in template["params"]}
    missing = [name for name, value in params.items() if not value]
    if missing:
        return jsonify({"error": f"missing params: {', '.join(missing)}"}), 400
    try:
        started = time.perf_counter()
        rows = sandbox_exec.run_cypher(get_sandbox(), template["cypher"], params)
        return jsonify({
            "intent": intent,
            "params": params,
            "cypher": textwrap.dedent(template["cypher"]).strip(),
            "elapsed_ms": round((time.perf_counter() - started) * 1000),
            "rows": rows,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/ask", methods=["POST"])
def ask():
    question = (request.get_json(silent=True) or {}).get("question", "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400
    try:
        result = agent.ask(question, get_sandbox(), get_client())
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(port=5050, debug=True)
