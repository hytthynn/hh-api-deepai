# -*- coding: utf-8 -*-
"""Источник Google-логинов (24h) -> accounts.txt

python redeem.py --buy 5 [--product 578]     # bulkmail.shop (ключ: env BM_KEY или ~/tmp/bm_buy.py)
python redeem.py --file codes.txt            # строки "email|password" или "email:password"
python redeem.py --check                     # показать, сколько логинов ещё не в банке
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request

import dpcode as D

ACCOUNTS = os.path.join(D.ROOT, "accounts.txt")
BM_BASE = "https://bulkmail.shop/api/v2"


def bm_key():
    D.load_env()  # повторно: .env мог появиться после импорта dpcode
    for name in ("BM_KEY", "BULKMAIL_KEY", "BULKMAIL_API_KEY", "BM_API_KEY"):
        k = os.environ.get(name)
        if k:
            k = k.strip().strip("'\"")
            if k:
                return k
    for p in (os.path.join(D.ROOT, ".env"), r"C:/Users/User/tmp/bm_buy.py",
              r"C:/Users/User/tmp/buy_batch.py"):
        if not os.path.exists(p):
            continue
        m = re.search(r'(?:KEY|BM_KEY|BULKMAIL_KEY)\s*=\s*["\']?([A-Za-z0-9_\-]{16,})',
                      open(p, encoding="utf-8-sig").read())
        if m:
            return m.group(1).strip("'\"")
    return None


def bm_get(path, key):
    req = urllib.request.Request(BM_BASE + path, headers={"X-API-Key": key,
                                                          "User-Agent": "Mozilla/5.0 Chrome/141"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def bm_post(path, key, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(BM_BASE + path, data=data, method="POST",
                                 headers={"X-API-Key": key, "Content-Type": "application/json",
                                          "User-Agent": "Mozilla/5.0 Chrome/141"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def buy(n, product):
    key = bm_key()
    if not key:
        D.log("BM_KEY не найден"); return []
    bal = bm_get("/wallet/balance", key)
    D.log("balance:", bal)
    order = bm_post("/orders", key, {"product_id": product, "quantity": n})
    D.log("order:", str(order)[:200])
    oid = None
    for k in ("id", "order_id", "data"):
        v = order.get(k) if isinstance(order, dict) else None
        if isinstance(v, dict):
            oid = v.get("id")
        elif isinstance(v, int):
            oid = v
        if oid:
            break
    time.sleep(2)
    path = f"/purchases?order_id={oid}" if oid else "/purchases"
    data = bm_get(path, key)
    items = data.get("data") if isinstance(data, dict) else data
    lines = []
    for it in items or []:
        raw = it.get("data") if isinstance(it, dict) else None
        if not raw:
            continue
        s = str(raw).strip()
        # "email|pass|note" или "email:pass"
        if "|" in s:
            parts = s.split("|")
            email, pw = parts[0].strip(), parts[1].strip()
        elif ":" in s:
            email, pw = s.split(":", 1)
            email, pw = email.strip(), pw.strip()
        else:
            continue
        if "@" in email:
            lines.append(f"{email}|{pw}")
    return lines[-n:] if n else lines


def append_accounts(lines, path=ACCOUNTS):
    have = set()
    if os.path.exists(path):
        for l in open(path, encoding="utf-8"):
            if "|" in l:
                have.add(l.split("|")[0].strip().lower())
    added = 0
    with open(path, "a", encoding="utf-8") as f:
        for l in lines:
            email = l.split("|")[0].strip().lower()
            if email in have:
                continue
            f.write(l + "\n")
            have.add(email)
            added += 1
    return added


def from_file(path):
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "|" in line:
            out.append(line)
        elif ":" in line:
            e, p = line.split(":", 1)
            out.append(f"{e.strip()}|{p.strip()}")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--buy", type=int, default=0)
    ap.add_argument("--product", type=int, default=578)
    ap.add_argument("--file", default=None)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    if a.buy:
        D.log(f"buy {a.buy} x product {a.product}")
        lines = buy(a.buy, a.product)
        D.log("got:", len(lines))
        for l in lines:
            D.log("  ", l.split("|")[0])
        D.log("added:", append_accounts(lines))
    if a.file:
        lines = from_file(a.file)
        D.log("from file:", len(lines), "added:", append_accounts(lines))
    if a.check:
        accts = [l.split("|")[0].lower() for l in open(ACCOUNTS, encoding="utf-8")] if os.path.exists(ACCOUNTS) else []
        done = {r["email"].lower() for r in D.read_bank() if r.get("stage") == "ok"}
        todo = [e for e in accts if e not in done]
        D.log(f"accounts={len(accts)} ok={len(done)} todo={len(todo)}")