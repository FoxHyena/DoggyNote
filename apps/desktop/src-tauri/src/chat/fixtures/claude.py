"""Deterministic Claude JSONL child for the shared Rust IO-loop tests."""
import json
import os
import sys

if sys.argv[1] == "closed-input":
    os.close(0)
else:
    assert sys.stdin.read() == "Only linked context"
print(json.dumps({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "A partial answer."}}}), flush=True)
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "A complete answer.", "usage": {"input_tokens": 3, "output_tokens": 4}}), flush=True)
