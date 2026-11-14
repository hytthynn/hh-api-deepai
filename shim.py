# -*- coding: utf-8 -*-
"""OpenAI-совместимый шлюз поверх DeepAI Code.

python shim.py --port 8770 --bank bank.jsonl

GET  /v1/models            каталог (free + premier)
POST /v1/chat/completions  chat, stream и non-stream
GET  /healthz              состояние пула

Ротация: аккаунт с 401/403 (кроме machine_required) /429/5xx уходит в cooldown,
запрос повторяется на следующем. Заголовки lane/machine/beacon ставятся здесь.
"""
import argparse
import json
import os
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

import dpcode as D

BANK_PATH = D.BANK
COOLDOWN = 120          # сек, сколько аккаунт не трогаем после 401/403/429/5xx
BUSY_COOLDOWN = 3       # 409 session_busy: аккаунт занят, отпускаем ненадолго
MAX_TRIES = 6
SLOT_WAIT = 45.0        # сколько ждём свободный аккаунт, прежде чем вернуть 429
MAX_HOLD = 900.0        # слот старше этого считаем зависшим и отбираем
_lock = threading.Lock()
_slot_cv = threading.Condition(_lock)
_inflight = {}          # email -> время захвата, один активный запрос на аккаунт
_state = {"cool": {}, "used": {}, "ok": 0, "fail": 0, "busy": 0, "queued": 0}


def accounts():
    return [r for r in D.read_bank(BANK_PATH) if r.get("cookies")]


def ordered():
    recs = accounts()
    now = time.time()
    fresh = [r for r in recs if _state["cool"].get(r["email"], 0) <= now]
    stale = [r for r in recs if _state["cool"].get(r["email"], 0) > now]
    # ротация по кругу: кто меньше использован — первым
    fresh.sort(key=lambda r: _state["used"].get(r["email"], 0))
    return fresh + stale


def _pick_free(now):
    """Свободный аккаунт: не в cooldown и без активного запроса."""
    for rec in ordered():
        email = rec["email"]
        held = _inflight.get(email)
        if held is not None:
            if now - held < MAX_HOLD:
                continue
            # зависший стрим: отбираем слот, иначе аккаунт выпадает навсегда
            _state["stolen"] = _state.get("stolen", 0) + 1
        if _state["cool"].get(email, 0) > now:
            continue
        _inflight[email] = now
        return rec
    return None


def acquire():
    """Занимает аккаунт под запрос. Одна сессия на аккаунт — требование апстрима."""
    deadline = time.time() + SLOT_WAIT
    with _slot_cv:
        while True:
            rec = _pick_free(time.time())
            if rec:
                return rec
            left = deadline - time.time()
            if left <= 0:
                return None
            _state["queued"] += 1
            _slot_cv.wait(min(0.5, max(0.05, left)))
            _state["queued"] = max(0, _state["queued"] - 1)


def release(email):
    if not email:
        return
    with _slot_cv:
        _inflight.pop(email, None)
        _slot_cv.notify_all()


def call_upstream(model, payload, stream):
    """Возвращает (requests.Response, rec) либо (None, (http_code, message))."""
    last = "no account"
    for _ in range(MAX_TRIES + 4):
        rec = acquire()
        if rec is None:
            return None, (429, "all accounts busy: " + last)
        email = rec["email"]
        machine = rec.get("machine") or D.machine_header(salt=email)
        s = D.session_from(rec)
        body = dict(payload)
        body["model"] = model
        body["stream"] = bool(stream)
        h = dict(D.lane_headers(machine))
        h.update({"Accept": "text/event-stream" if stream else "application/json",
                  "Content-Type": "application/json"})
        try:
            r = requests.post(D.API + "/deepai_code/chat/completions", json=body,
                              headers=h, cookies=s.cookies.get_dict(), stream=stream, timeout=300)
        except Exception as e:
            release(email)
            last = str(e)[:120]
            _state["cool"][email] = time.time() + 30
            continue
        with _lock:
            _state["used"][email] = _state["used"].get(email, 0) + 1
        if r.status_code == 200:
            _state["ok"] += 1
            return r, rec  # слот освобождает обработчик после отдачи тела

        text = ""
        try:
            text = r.text[:200]
        except Exception:
            pass
        last = f"{r.status_code} {text}"
        # лимит апстрима: одна активная coding-сессия на аккаунт
        if r.status_code == 409 or "session_busy" in text:
            retry_after = r.headers.get("Retry-After")
            delay = BUSY_COOLDOWN
            try:
                delay = max(1.0, min(60.0, float(retry_after)))
            except (TypeError, ValueError):
                pass
            release(email)
            _state["busy"] += 1
            _state["cool"][email] = time.time() + delay
            continue
        # machine_required лечится пересчётом machine-id, а не сменой аккаунта
        if "machine_required" in text:
            rec["machine"] = D.machine_header(salt=email + secrets.token_hex(4))
            release(email)
            _state["cool"][email] = time.time() + 5
            continue
        if r.status_code in (401, 403, 429) or r.status_code >= 500:
            release(email)
            _state["cool"][email] = time.time() + COOLDOWN
            _state["fail"] += 1
            continue
        return r, rec  # 400 и прочие клиентские — отдаём как есть
    return None, (503, "all accounts failed: " + last)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def handle_one_request(self):
        """Клиент, закрывший keep-alive сокет, — норма, а не повод для трейсбека."""
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            self.wfile.write(data)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    def do_GET(self):
        if self.path.startswith("/healthz"):
            recs = accounts()
            now = time.time()
            self._json(200, {
                "accounts": len(recs),
                "cooling": sum(1 for r in recs if _state["cool"].get(r["email"], 0) > now),
                "inflight": len(_inflight),
                "inflight_ages": {k: round(now - v, 1) for k, v in _inflight.items()},
                "queued": _state["queued"],
                "requests_ok": _state["ok"], "requests_fail": _state["fail"],
                "requests_busy": _state["busy"], "slots_stolen": _state.get("stolen", 0),
            })
            return
        if self.path.startswith("/v1/models"):
            data = [{"id": m, "object": "model", "owned_by": "deepai",
                     "permission": [], "root": m, "parent": None}
                    for m in D.ALL_MODELS]
            self._json(200, {"object": "list", "data": data})
            return
        self._json(404, {"error": {"message": "not found", "type": "not_found"}})

    def do_POST(self):
        if not self.path.startswith("/v1/chat/completions"):
            self._json(404, {"error": {"message": "not found", "type": "not_found"}})
            return
        n = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            self._json(400, {"error": {"message": f"bad json: {e}", "type": "invalid_request"}})
            return
        model = payload.get("model") or "glm-5.3-flash"
        stream = bool(payload.get("stream"))
        if model not in D.ALL_MODELS:
            self._json(404, {"error": {"message": f"model '{model}' not found",
                                       "type": "model_not_found", "code": "model_not_found"}})
            return
        r, meta = call_upstream(model, payload, stream)
        if r is None:
            code, msg = meta if isinstance(meta, tuple) else (503, str(meta))
            self._json(code, {"error": {"message": msg,
                                        "type": "rate_limit" if code == 429 else "no_account",
                                        "code": "session_busy" if code == 429 else "no_account"}})
            return
        held = (meta or {}).get("email")
        try:
            if stream and r.status_code == 200:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                try:
                    for chunk in r.iter_lines(decode_unicode=False):
                        if chunk is None:
                            continue
                        self.wfile.write(chunk + b"\n\n")
                        self.wfile.flush()
                except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                    pass
                except Exception:
                    pass
                return
            body = r.content
            try:
                self.send_response(r.status_code)
                self.send_header("Content-Type", r.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                self.wfile.write(body)
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                self.close_connection = True
        finally:
            release(held)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # На Windows SO_REUSEADDR (allow_reuse_address=True) разрешает двум процессам
    # слушать один порт — запросы уходят в случайный инстанс. Запрещаем.
    allow_reuse_address = False

    def server_bind(self):
        import socket as _socket
        if hasattr(_socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(_socket.SOL_SOCKET, _socket.SO_EXCLUSIVEADDRUSE, 1)
        ThreadingHTTPServer.server_bind(self)

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        ThreadingHTTPServer.handle_error(self, request, client_address)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--bank", default=D.BANK)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    global BANK_PATH
    BANK_PATH = a.bank
    recs = accounts()
    D.log(f"bank={a.bank} accounts={len(recs)}")
    if not recs:
        D.log("WARN: банк пуст — сначала oauth.py / wave.py")
    try:
        srv = Server((a.host, a.port), H)
    except OSError as e:
        D.log(f"port {a.port} busy ({e.strerror or e}) — уже запущен другой шлюз: "
              f"Get-NetTCPConnection -LocalPort {a.port} -State Listen")
        sys.exit(2)
    D.log(f"listening http://{a.host}:{a.port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        D.log("shutdown")


if __name__ == "__main__":
    main()