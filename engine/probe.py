# -*- coding: utf-8 -*-
"""Проверка банка: баланс, каталог, живой чат по выбранным моделям + замер расхода Theos.

python probe.py --all            # все аккаунты: theos + 2 бесплатные модели
python probe.py --models         # каталог моделей (premier/ctx) с первого живого аккаунта
python probe.py --matrix         # матрица моделей на одном аккаунте: статус/латентность/расход
"""
import argparse
import json
import sys
import time

import dpcode as D


def acc_health(rec):
    machine = rec.get("machine") or D.machine_header(salt=rec.get("email"))
    s = D.session_from(rec)
    st, body = D.theos(s, machine)
    bal = None
    if isinstance(body, dict):
        try:
            bal = float(body.get("balance") or 0)
        except Exception:
            bal = None
    return st, body, bal, s, machine


def cmd_all():
    recs = D.read_bank()
    live = 0
    for rec in recs:
        if not rec.get("cookies"):
            continue
        st, body, bal, s, machine = acc_health(rec)
        line = f"{rec['email'][:38]:38s} theos={st} bal={bal}"
        if st == 200:
            r = D.chat(s, machine, "glm-5.3-flash", [{"role": "user", "content": "say ok"}], 32)
            content = ""
            try:
                content = r.json()["choices"][0]["message"]["content"][:20]
            except Exception:
                content = r.text[:40]
            line += f" chat={r.status_code} {content!r}"
            if r.status_code == 200:
                live += 1
        print(line, flush=True)
    print(f"LIVE {live}/{len(recs)}")


def cmd_models():
    for rec in D.read_bank():
        if not rec.get("cookies"):
            continue
        machine = rec.get("machine") or D.machine_header(salt=rec.get("email"))
        s = D.session_from(rec)
        st, body = D.models(s, machine)
        if st != 200 or "models" not in body:
            print("models fail", st)
            continue
        for e in body["models"]:
            print(f"{e['id']:26s} premier={e.get('premier')} ctx={e.get('contextWindow')} "
                  f"max={e.get('maxTokens')} input={e.get('input')}")
        return


def cmd_matrix():
    recs = [r for r in D.read_bank() if r.get("cookies")]
    if not recs:
        print("bank пуст")
        return
    rec = recs[-1]
    machine = rec.get("machine") or D.machine_header(salt=rec.get("email"))
    s = D.session_from(rec)
    st0, body0 = D.theos(s, machine)
    bal0 = float(body0.get("balance") or 0) if isinstance(body0, dict) else None
    print(f"ACCT {rec['email']} bal0={bal0}")
    for m in D.ALL_MODELS:
        t0 = time.time()
        r = D.chat(s, machine, m, [{"role": "user", "content": "Say READY in one word."}], 32)
        dt = round(time.time() - t0, 2)
        content = ""
        try:
            content = (r.json()["choices"][0]["message"].get("content") or "")[:24]
        except Exception:
            content = r.text[:60].replace("\n", " ")
        print(f"{m:26s} {r.status_code} {dt:6.2f}s {content!r}", flush=True)
    st1, body1 = D.theos(s, machine)
    bal1 = float(body1.get("balance") or 0) if isinstance(body1, dict) else None
    print(f"THEOS {bal0} -> {bal1} (spent {round((bal0 or 0) - (bal1 or 0), 4)})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--models", action="store_true")
    ap.add_argument("--matrix", action="store_true")
    a = ap.parse_args()
    if a.models:
        cmd_models()
    elif a.matrix:
        cmd_matrix()
    else:
        cmd_all()