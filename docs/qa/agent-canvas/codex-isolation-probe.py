"""Manual Codex 0.163.0 isolation probe. No real credentials or model request.

Run: python3 docs/qa/agent-canvas/codex-isolation-probe.py /absolute/path/to/codex [--rust-adapter]
Uses a synthetic config/MCP trap and loopback Responses fixture. This is research
evidence; --rust-adapter also drives the production adapter against the fake endpoint.
Neither mode is a live-provider acceptance check.
"""

import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


def toml(value):
    if isinstance(value, dict):
        return "{" + ",".join(key + "=" + toml(item) for key, item in value.items()) + "}"
    return json.dumps(value)


requests = []


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        item = {"id": "msg_probe", "type": "message", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": "Synthetic probe only.", "annotations": []}]}
        events = [
            {"type": "response.created", "response": {"id": "response_probe", "object": "response", "status": "in_progress"}},
            {"type": "response.output_item.added", "output_index": 0, "item": {**item, "content": []}},
            {"type": "response.output_text.delta", "item_id": "msg_probe", "output_index": 0, "content_index": 0, "delta": "Synthetic probe only."},
            {"type": "response.output_item.done", "output_index": 0, "item": item},
            {"type": "response.completed", "response": {"id": "response_probe", "object": "response", "status": "completed", "output": [item], "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}},
        ]
        body = "".join("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n" for event in events).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def configuration(port):
    return {
        "mcp_servers": {}, "notify": [], "project_doc_max_bytes": 0,
        "features.multi_agent_v2": {"enabled": True, "disable_native_tools": True},
        **{"features." + name: False for name in ["shell_tool", "multi_agent", "apps", "plugins", "hooks", "memories", "shell_snapshot", "view_image", "goals", "sleep_tool", "default_mode_request_user_input"]},
        "features.skip_host_skill_discovery": True,
        "web_search": "disabled", "model": "gpt-5.4", "model_provider": "synthetic",
        "model_providers.synthetic": {"name": "Local fixture", "base_url": f"http://127.0.0.1:{port}/v1", "env_key": "DOGGYNOTE_FAKE_KEY", "wire_api": "responses", "requires_openai_auth": False, "supports_websockets": False},
    }


def synthetic_environment(directory):
    return {"PATH": "/usr/bin:/bin", "HOME": directory, "CODEX_HOME": directory, "DOGGYNOTE_FAKE_KEY": "synthetic-not-a-credential", "RUST_LOG": "off"}


def install_trap(root):
    trap = root / "MCP_WAS_STARTED"
    (root / "config.toml").write_text('[mcp_servers.synthetic_trap]\ncommand="/usr/bin/touch"\nargs=[' + json.dumps(str(trap)) + ']\n')
    return trap


def probe(binary, server, ignore_config):
    with tempfile.TemporaryDirectory(prefix="doggynote-codex-isolation-") as directory:
        root = Path(directory)
        trap = install_trap(root)
        args = [binary, "--strict-config", "--no-daemon"]
        for key, value in configuration(server.server_port).items():
            args += ["-c", key + "=" + toml(value)]
        args += ["exec", "--ephemeral", "--json", "--skip-git-repo-check"]
        if ignore_config:
            args += ["--ignore-user-config", "--ignore-rules"]
        args += ["Reply to this synthetic probe."]
        # A separate temporary home keeps the fixture independent of real auth,
        # project instructions, rules and provider configuration.
        environment = synthetic_environment(directory)
        before = len(requests)
        result = subprocess.run(args, cwd=directory, env=environment, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25)
        assert result.returncode == 0, "Synthetic CLI run failed: " + result.stderr[:500]
        assert len(requests) == before + 1, "Expected exactly one loopback model request"
        tools = [tool.get("name", tool.get("type")) for tool in requests[-1].get("tools", [])]
        events = [json.loads(line) for line in result.stdout.splitlines()]
        assert events[-1]["type"] == "turn.completed"
        assert trap.exists() is not ignore_config, "Inherited MCP launch behavior changed"
        if ignore_config:
            assert set(tools) <= {"request_user_input"}, "Unexpected tools: " + repr(tools)
        print(json.dumps({"ignore_user_config": ignore_config, "inherited_mcp_launched": trap.exists(), "advertised_tools": tools, "output_events": [event["type"] for event in events]}))


def app_server_probe(binary, server):
    with tempfile.TemporaryDirectory(prefix="doggynote-codex-rpc-") as directory:
        trap = install_trap(Path(directory))
        args = [binary, "--strict-config", "app-server", "--listen", "stdio://"]
        for key, value in configuration(server.server_port).items():
            args += ["-c", key + "=" + toml(value)]
        process = subprocess.Popen(args, cwd=directory, env=synthetic_environment(directory), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
        messages = queue.Queue()
        methods = []

        def read():
            for line in process.stdout:
                value = json.loads(line)
                methods.append(value.get("method"))
                messages.put(value)

        threading.Thread(target=read, daemon=True).start()

        def send(method, request_id=None, params=None):
            value = {"method": method}
            if request_id is not None:
                value["id"] = request_id
            if params is not None:
                value["params"] = params
            process.stdin.write(json.dumps(value) + "\n")
            process.stdin.flush()

        def response(request_id):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                value = messages.get(timeout=max(0.01, deadline - time.monotonic()))
                if value.get("id") == request_id:
                    assert "error" not in value, repr(value.get("error"))
                    return value["result"]
            raise AssertionError("RPC response timed out")

        before = len(requests)
        try:
            send("initialize", 1, {"clientInfo": {"name": "doggynote_isolation_probe", "version": "0.0.0"}, "capabilities": {"experimentalApi": True}})
            response(1)
            send("initialized")
            send("config/read", 2, {"includeLayers": False})
            config = response(2)["config"]
            assert isinstance(config.get("mcp_servers"), dict)
            assert not trap.exists(), "MCP started before thread creation"
            disabled = {name: {"enabled": False} for name in config["mcp_servers"]}
            send("thread/start", 3, {"cwd": directory, "ephemeral": True, "approvalPolicy": "never", "sandbox": "read-only", "baseInstructions": "Use only the supplied text. Do not use tools.", "config": {"mcp_servers": disabled}})
            thread_id = response(3)["thread"]["id"]
            send("mcpServerStatus/list", 5, {"threadId": thread_id, "detail": "full", "limit": 100})
            inventory = response(5)
            assert all(row.get("runtimeStatus") == "disabled" and not row.get("tools") and not row.get("resources") and not row.get("resourceTemplates") for row in inventory["data"]) and inventory.get("nextCursor") is None, "MCP capabilities are not empty"
            send("turn/start", 4, {"threadId": thread_id, "input": [{"type": "text", "text": "Synthetic probe only."}]})
            response(4)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                event = messages.get(timeout=max(0.01, deadline - time.monotonic()))
                if event.get("method") == "turn/completed":
                    assert event["params"]["turn"]["status"] == "completed"
                    break
            else:
                raise AssertionError("Turn did not complete")
            assert len(requests) == before + 1
            tools = [tool.get("name", tool.get("type")) for tool in requests[-1].get("tools", [])]
            assert set(tools) <= {"request_user_input"}, repr(tools)
            assert "DOGGYNOTE_UNLINKED_CONFIG" not in json.dumps(requests[-1]), "Inherited instructions leaked into model input"
            assert not trap.exists(), "Inherited MCP launched"
            assert "item/agentMessage/delta" in methods
            print(json.dumps({"transport": "app-server", "inherited_mcp_launched": False, "text_delta_received": True, "advertised_tools": tools}))
        finally:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


if __name__ == "__main__":
    binary = str(Path(sys.argv[1]).resolve())
    server = HTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        probe(binary, server, False)
        probe(binary, server, True)
        app_server_probe(binary, server)
        if "--rust-adapter" in sys.argv[2:]:
            before = len(requests)
            manifest = Path(__file__).resolve().parents[3] / "apps/desktop/src-tauri/Cargo.toml"
            result = subprocess.run(["cargo", "test", "--manifest-path", str(manifest), "--lib", "--offline", "chat::tests::installed_codex_uses_production_adapter_with_only_synthetic_inference", "--", "--ignored", "--exact"], env={**os.environ, "DOGGYNOTE_TEST_CODEX_BIN": binary, "DOGGYNOTE_TEST_MODEL_PORT": str(server.server_port)}, capture_output=True, text=True, timeout=60)
            assert result.returncode == 0, result.stdout + result.stderr
            assert len(requests) == before + 2
            tools = [tool.get("name", tool.get("type")) for tool in requests[-1].get("tools", [])]
            assert set(tools) <= {"request_user_input"}, repr(tools)
            assert "DOGGYNOTE_UNLINKED_CONFIG" not in json.dumps(requests[before:]), "Inherited instructions leaked into model input"
            print(json.dumps({"transport": "production-rust-adapter", "global_instruction_file_rejected_before_inference": True, "model_instructions_replaced": True, "inherited_mcp_launched": False, "completed": True, "advertised_tools": tools}))
    finally:
        server.shutdown()
