#!/usr/bin/env python3
"""Minimal backend for the demo front end: one POST /ask endpoint.
Reuses a single Anthropic client and a single Daytona sandbox across
requests (created once at startup) instead of per-question.
"""
import os

import anthropic
from flask import Flask, jsonify, request, send_from_directory

import agent
import sandbox_exec

app = Flask(__name__, static_folder="static", static_url_path="")

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
