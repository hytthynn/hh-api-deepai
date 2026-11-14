# -*- coding: utf-8 -*-
"""Волна: accounts.txt (email|password построчно) -> bank.jsonl, с резюмом.

python wave.py --limit 20 --workers 2 [--proxy http://...] [--headless]
Резюм: аккаунт с stage=ok в bank.jsonl повторно не гоняется.
"""
import argparse
import json
import os
import re
import sys
import time

import dpcode as D
import oauth as O

LOCK = os.path.join(D.ROOT, ".wave.lock")
ACCOUNTS = os.path.join(D.ROOT, "accounts.txt")


def load_accounts(path):
    out = []
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "|" in line:
            email, pw = line.split("|", 1)
        elif ":" in line:
            email, pw = line.split(":", 1)
        else:
            continue
        out.append((email.strip(), pw.strip()))
    return out


def done_set():
    d = set()
    for rec in D.read_bank():
        if rec.get("stage") == "ok":
            d.add(rec["email"].lower())
        elif rec.get("stage") in ("GOOGLE_REJECTED", "GOOGLE_CAPTCHA", "IAP"):
            d.add(rec["email"].lower())  # брак: не жечь прогоны повторно
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accounts", default=ACCOUNTS)
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--proxy", default=None)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--retry-failed", action="store_true")
    a = ap.parse_args()

    if os.path.exists(LOCK):
        pid = open(LOCK).read().strip()
        D.log(f"LOCK exists (pid={pid}); удали .wave.lock если процесс мёртв")
        return
    open(LOCK, "w").write(str(os.getpid()))
    try:
        accts = load_accounts(a.accounts)
        done = set() if a.retry_failed else done_set()
        todo = [(e, p) for e, p in accts if e.lower() not in done][: a.limit]
        D.log(f"accounts={len(accts)} done={len(done)} todo={len(todo)} workers={a.workers}")

        ok = bad = 0
        # Chrome умирает после ~14 подряд -> воркер перезапускается поштучно (контекст на аккаунт)
        for i, (email, pw) in enumerate(todo, 1):
            r = O.one(email, pw, a.proxy, a.headless)
            stage = r.get("stage")
            if r.get("ok"):
                ok += 1
                bal = (r.get("theos") or {}).get("balance")
                D.log(f"[{i}/{len(todo)}] OK {email} balance={bal}")
            else:
                bad += 1
                D.log(f"[{i}/{len(todo)}] FAIL {email} {stage}")
            time.sleep(1.0)
        D.log(f"DONE ok={ok} fail={bad}")
    finally:
        try:
            os.remove(LOCK)
        except Exception:
            pass


if __name__ == "__main__":
    main()