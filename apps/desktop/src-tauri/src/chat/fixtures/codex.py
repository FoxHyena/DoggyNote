"""Deterministic child for Rust's production IO-loop tests; never a provider."""
import json
import os
import sys
import time

scenario = sys.argv[1]


def send(value):
    print(json.dumps(value), flush=True)


def receive(method, request_id):
    value = json.loads(sys.stdin.readline())
    assert value.get("method") == method and value.get("id") == request_id
    return value.get("params", {})


def event(method, **params):
    send({"method": method, "params": {"threadId": "fixture-thread", "turnId": "fixture-turn", **params}})


receive("initialize", 1)
send({"id": 1, "result": {"userAgent": "synthetic"}})
receive("initialized", None)
receive("config/read", 2)
features = {}
for arg in sys.argv:
    if arg.startswith("features.") and "=" in arg:
        name, value = arg[len("features."):].split("=", 1)
        features[name] = {"enabled": True, "disable_native_tools": True} if name == "multi_agent_v2" else value == "true"
send({"id": 2, "result": {"config": {"features": features, "mcp_servers": {"hidden": {"command": "must-not-launch"}, "name.with.dots": {}}}}})
start = receive("thread/start", 3)
assert start["ephemeral"] and start["sandbox"] == "read-only"
assert start["config"]["mcp_servers"] == {"hidden": {"enabled": False}, "name.with.dots": {"enabled": False}}
send({"id": 3, "result": {"approvalPolicy": "never", "sandbox": {"type": "readOnly"}, "cwd": os.getcwd(), "instructionSources": [], "thread": {"id": "fixture-thread", "ephemeral": True}}})
receive("mcpServerStatus/list", 5)
inventory = {"runtimeStatus": "ready" if scenario == "wide" else "disabled", "tools": {}, "resources": [], "resourceTemplates": []}
send({"id": 5, "result": {"data": [inventory], "nextCursor": None}})
if scenario == "wide":
    time.sleep(30)
    raise AssertionError("Host should stop before inference")
turn = receive("turn/start", 4)
assert turn["input"][0]["text"] == "Only linked context"
send({"id": 4, "result": {"turn": {"id": "fixture-turn"}}})
event("item/reasoning/textDelta", delta="PRIVATE REASONING")
event("item/agentMessage/delta", itemId="answer", delta="A partial answer.")
if scenario == "hang":
    time.sleep(30)
elif scenario == "malformed":
    print("not JSON", flush=True)
elif scenario == "rate":
    event("turn/completed", turn={"id": "fixture-turn", "status": "failed", "error": {"message": "rate limit"}})
elif scenario == "question":
    send({"id": "question-1", "method": "item/tool/requestUserInput", "params": {"threadId": "fixture-thread", "turnId": "fixture-turn", "itemId": "question", "isBlocking": True, "questions": [{"id": "tone", "header": "Tone", "question": "Which tone?"}]}})
    response = json.loads(sys.stdin.readline())
    assert response == {"id": "question-1", "result": {"answers": {"tone": {"answers": ["Playful"]}}}}
    event("item/completed", item={"id": "answer", "type": "agentMessage", "text": "A playful kickoff."})
    event("thread/tokenUsage/updated", tokenUsage={"total": {"inputTokens": 12, "outputTokens": 4}})
    event("turn/completed", turn={"id": "fixture-turn", "status": "completed"})
else:
    event("item/completed", item={"id": "answer", "type": "agentMessage", "text": "A complete answer."})
    event("turn/completed", turn={"id": "fixture-turn", "status": "completed"})
    event("item/completed", item={"id": "late", "type": "agentMessage", "text": "LATE MUST NOT APPEAR"})
