#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Single-operation NDJSON worker: register one bought Google login.

Contract: docs/SPEC.md §18. One command per line on stdin, one result line on
stdout, stage events in between. Never writes bank.jsonl (HH_ENGINE_NO_BANK=1).
"""
import json
import os
import sys
import time
import traceback

os.environ["HH_ENGINE_NO_BANK"] = "1"
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

import dpcode as D  # noqa: E402
import oauth  # noqa: E402


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def emit_stage(command_id, stage, detail=None):
    event = {"id": command_id, "event": "stage", "stage": stage}
    if detail:
        event["detail"] = str(detail).split("?", 1)[0][:160]
    emit(event)


def hello():
    playwright_version = "unknown"
    try:
        import importlib.metadata
        playwright_version = importlib.metadata.version("playwright")
    except Exception:
        pass
    chrome = D.CHROME if os.path.exists(D.CHROME) else None
    emit({
        "event": "hello",
        "python": sys.version.split()[0],
        "playwright": playwright_version,
        "chrome": chrome or "playwright-managed",
        "chrome_ok": chrome is not None,
    })


def register(command):
    command_id = str(command["id"])
    email = str(command["email"])
    password = str(command["password"])
    headless = bool(command.get("headless", False))
    proxy = command.get("proxy") or None
    start = time.monotonic()
    emit_stage(command_id, "oauth", D.OAUTH_START)
    try:
        result = oauth.one(email, password, proxy=proxy, headless=headless, keep_profile=False)
    except Exception as exc:
        return {
            "id": command_id,
            "event": "result",
            "ok": False,
            "stage": "exc:" + type(exc).__name__,
            "detail": str(exc)[:160],
            "ms": int((time.monotonic() - start) * 1000),
        }

    stage = str(result.get("stage") or "unknown")
    ok = bool(result.get("ok"))
    if stage == "ok" and not ok:
        emit_stage(command_id, "probing", "deepai_code/theos")
    emit_stage(command_id, "ok" if ok else "failed", "theos" if ok else stage)

    payload = {
        "id": command_id,
        "event": "result",
        "ok": ok,
        "stage": stage,
        "cookies": result.get("cookies", []),
        "machine": result.get("machine"),
        "theos_status": result.get("theos_status"),
        "lane_version": 4,
        "ms": int((time.monotonic() - start) * 1000),
    }
    theos_body = result.get("theos")
    if isinstance(theos_body, dict):
        payload["theos"] = theos_body
        try:
            payload["lane_version"] = int(theos_body.get("lane_version") or 4)
        except (TypeError, ValueError):
            payload["lane_version"] = 4
    elif theos_body is not None:
        payload["detail"] = str(theos_body)[:160]
    if result.get("url"):
        payload["url"] = str(result["url"]).split("?", 1)[0][:160]
    return payload


def main():
    hello()
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        command = None
        try:
            command = json.loads(raw)
            if not isinstance(command, dict):
                continue
            operation = command.get("op")
            if operation == "shutdown":
                return
            if operation != "register":
                emit({"id": command.get("id"), "event": "result", "ok": False, "stage": "unsupported_op"})
                continue
            emit(register(command))
        except Exception as exc:
            emit({
                "id": command.get("id") if isinstance(command, dict) else None,
                "event": "result",
                "ok": False,
                "stage": "worker_error:" + type(exc).__name__,
                "detail": str(exc)[:160],
            })
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
