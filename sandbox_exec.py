"""Runs agent-generated Cypher inside a Daytona sandbox, never directly from
this process. Neo4j's Bolt port (7687) is blocked on this Daytona account's
network tier, so execution goes through Neo4j's HTTP Query API (plain HTTPS
on port 443) instead of the Bolt driver -- see kanji-graph-plan.md for the
sponsor-integration requirement this satisfies.

One sandbox is created and reused across all queries in a session (spinning
up a fresh sandbox per question would add multiple seconds of latency to
every demo answer).
"""
import json
import os

from daytona import CodeRunParams, CreateSandboxFromImageParams, Daytona, DaytonaConfig

SANDBOX_ID_FILE = os.path.join(os.path.dirname(__file__), ".sandbox_id")


def _neo4j_host():
    return os.environ["NEO4J_URI"].split("//")[1]


def get_daytona_client():
    return Daytona(DaytonaConfig(api_key=os.environ["DAYTONA_API_KEY"]))


def get_or_create_sandbox(client):
    if os.path.exists(SANDBOX_ID_FILE):
        sandbox_id = open(SANDBOX_ID_FILE).read().strip()
        try:
            return client.get(sandbox_id)
        except Exception:
            pass  # stale id (sandbox expired/deleted) -- fall through and create a new one

    host = _neo4j_host()
    sandbox = client.create(CreateSandboxFromImageParams(
        image="python:3.12-slim",
        language="python",
        # Bolt (7687) is blocked regardless of this list -- only used to reach
        # Neo4j's HTTP Query API on 443, plus PyPI to install `requests`.
        domain_allow_list=f"{host},pypi.org,files.pythonhosted.org",
    ))
    sandbox.process.exec("pip install -q requests", timeout=60)
    with open(SANDBOX_ID_FILE, "w") as f:
        f.write(sandbox.id)
    return sandbox


def run_cypher(sandbox, cypher):
    """Executes `cypher` inside the sandbox via Neo4j's HTTP Query API.
    Returns a list of row dicts. Raises RuntimeError on any Neo4j-reported
    or transport error (caller can feed the message back to the LLM retry).
    """
    host = _neo4j_host()
    code = f"""
import os, json, requests
resp = requests.post(
    "https://{host}/db/" + os.environ["NEO4J_USER"] + "/query/v2",
    auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"]),
    json={{"statement": {json.dumps(cypher)}}},
    timeout=15,
)
print(json.dumps({{"status": resp.status_code, "body": resp.json()}}))
"""
    result = sandbox.process.code_run(code, params=CodeRunParams(env={
        "NEO4J_USER": os.environ["NEO4J_USER"],
        "NEO4J_PASSWORD": os.environ["NEO4J_PASSWORD"],
    }), timeout=25)

    if result.exit_code != 0:
        raise RuntimeError(f"sandbox execution failed: {result.result}")

    outcome = json.loads(result.result.strip().splitlines()[-1])
    body = outcome["body"]
    if "errors" in body and body["errors"]:
        raise RuntimeError(body["errors"][0].get("message", str(body["errors"])))

    fields = body["data"]["fields"]
    return [dict(zip(fields, row)) for row in body["data"]["values"]]
