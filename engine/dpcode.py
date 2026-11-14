# -*- coding: utf-8 -*-
"""DeepAI Code — общий слой: machine-id, lane-заголовки, сессия, проба, банк."""
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ENGINE_DIR)          # данные (bank.jsonl, accounts.txt, prof/) живут в корне репо
BANK = os.path.join(ROOT, "bank.jsonl")
API = "https://api.deepai.org"
OAUTH_START = API + "/accounts/google/login/?process=login"
CHROME = r"C:/Program Files/Google/Chrome/Application/chrome.exe"

FREE_MODELS = [
    "glm-5.3-flash", "deepseek-v4.1-flash", "mimo-2.6-flash", "qwen-3.8-flash",
    "minimax-m3.1-flash", "muse-ember", "solar-mini-4", "gpt-6-luna",
    "mimo-2.6-pro", "glyph-cluster", "deepai-cyber",
]
PAID_MODELS = [
    "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "gpt-6.1-sol",
    "gpt-6.1-terra", "gpt-6-astra", "gemini-4-argon", "gemini-4-hydrogen",
    "gemini-4-carbon", "glm-5.3", "kimi-k3", "kimi-k3.1-pro", "minimax-m3",
    "muse-spark-1.3", "muse-wonder", "qwen-3.8-max-prime",
]
ALL_MODELS = FREE_MODELS + PAID_MODELS


def log(*a):
    print(*a, flush=True)


def load_env(path=None):
    """Читает ROOT/.env в os.environ. Реальный env главнее: setdefault."""
    path = path or os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return {}
    loaded = {}
    for line in open(path, encoding="utf-8-sig"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        if not k:
            continue
        loaded[k] = v
        os.environ.setdefault(k, v)
    return loaded


ENV = load_env()


def read_bank(path=BANK):
    raw = []
    if not os.path.exists(path):
        return raw
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            raw.append(json.loads(line))
        except Exception:
            pass
    # дедуп: последняя запись по email побеждает (волна может писать неудачу, потом успех)
    latest = {}
    for rec in raw:
        email = (rec.get("email") or "").lower()
        if not email:
            continue
        latest[email] = rec
    return list(latest.values())


def append_bank(rec, path=BANK):
    """HH_ENGINE_NO_BANK=1: веб-воркер не пишет bank.jsonl, результат уходит в stdout."""
    if os.environ.get("HH_ENGINE_NO_BANK") == "1":
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def machine_raw():
    """UUID железа: Windows MachineGuid, иначе SMBIOS UUID (Linux)."""
    try:
        out = subprocess.run(["reg", "query", r"HKLM\SOFTWARE\Microsoft\Cryptography",
                              "/v", "MachineGuid"], capture_output=True, text=True, timeout=10).stdout
        m = re.search(r"MachineGuid\s+REG_SZ\s+(\S+)", out)
        if m:
            return m.group(1).lower()
    except Exception:
        pass
    try:
        out = subprocess.run(["cat", "/sys/class/dmi/id/product_uuid"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        if re.match(r"^[0-9a-f-]{36}$", out, re.I):
            return out.lower()
    except Exception:
        pass
    return None


def machine_header(raw=None, salt=None):
    """sha256(UUID). salt позволяет выдавать новый «девайс» на аккаунт: sha256(uuid+salt)."""
    raw = raw or machine_raw() or secrets.token_hex(16)
    if salt:
        raw = raw + salt
    return hashlib.sha256(raw.encode()).hexdigest()


def lane_headers(machine=None, instance=None, beacon="v=1.3.0;up=120;pi=0;focus=1"):
    h = {"X-DeepAI-Code-Theos": "4",
         "X-DeepAI-Code-Instance": instance or secrets.token_hex(16)}
    if machine:
        h["X-DeepAI-Code-Machine"] = machine
    if beacon:
        h["X-DeepAI-Code-Beacon"] = beacon
    return h


def session_from(rec):
    s = requests.Session()
    s.headers.update({
        "User-Agent": "DeepAI-Code",
        "Origin": "https://deepai.org",
        "Referer": "https://deepai.org/",
    })
    for c in rec.get("cookies", []):
        if "deepai" in c.get("domain", ""):
            s.cookies.set(c["name"], c["value"], domain="deepai.org")
    return s


def theos(s, machine):
    r = s.get(API + "/deepai_code/theos", headers=lane_headers(machine), timeout=30)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text[:200]


def chat(s, machine, model, messages, max_tokens=256, stream=False, timeout=180):
    body = {"model": model, "messages": messages, "stream": stream, "max_tokens": max_tokens}
    h = dict(lane_headers(machine))
    h.update({"Accept": "text/event-stream", "Content-Type": "application/json"})
    return s.post(API + "/deepai_code/chat/completions", json=body, headers=h, timeout=timeout)


def models(s, machine):
    r = s.get(API + "/deepai_code/models", headers=lane_headers(machine), timeout=30)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text[:200]


def pick(recs, model=None):
    """Живой аккаунт с положительным балансом; при желании — первый, у кого модель ещё в квоте."""
    for rec in recs:
        if not rec.get("cookies"):
            continue
        machine = rec.get("machine") or machine_header(salt=rec.get("email"))
        s = session_from(rec)
        st, body = theos(s, machine)
        if st == 200 and isinstance(body, dict):
            try:
                bal = float(body.get("balance") or 0)
            except Exception:
                bal = 0.0
            if bal > 0 or model in FREE_MODELS:
                yield rec, s, machine, bal