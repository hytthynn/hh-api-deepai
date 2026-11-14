# -*- coding: utf-8 -*-
"""Один аккаунт: Google OAuth на api.deepai.org -> cookies -> bank.jsonl.

python oauth.py <email> <password> [--proxy http://127.0.0.1:8899] [--headless]
"""
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

import dpcode as D

PROF_ROOT = os.path.join(D.ROOT, "prof")


def oauth_flow(page, email, pw, rounds=10):
    """Крутит шаги Google до приземления на api.deepai.org. Возвращает статус."""
    last_txt = ""
    for r in range(rounds):
        url = page.url or ""
        try:
            low = page.inner_text("body").lower()
        except Exception:
            low = ""

        if "deepai.org" in url and "accounts.google" not in url:
            if "social network login failure" in low:
                return "ALLAUTH_FAIL"
            return "ok"

        if "accounts.google.com" in url:
            if "devicephoneverification" in url or "crossflowverification" in url:
                return "IAP"
            if "challenge/recaptcha" in url:
                return "GOOGLE_CAPTCHA"
            if "/signin/rejected" in url:
                return "GOOGLE_REJECTED"

            # identifier
            filled = False
            for sel in ("input[name=identifier]", "#identifierId", "input[type=email]"):
                try:
                    el = page.locator(sel).first
                    if el.count() and el.is_visible():
                        el.fill(email)
                        filled = True
                        break
                except Exception:
                    continue
            if filled:
                for sel in ("#identifierNext", "button:has-text('Далее')", "button:has-text('Next')"):
                    try:
                        el = page.locator(sel).first
                        if el.count() and el.is_visible():
                            el.click(timeout=6000)
                            break
                    except Exception:
                        continue
                page.wait_for_timeout(5000)
                continue

            # password
            filled = False
            for sel in ("input[name=password]", "input[name=Passwd]",
                        "input[type=password]:not([name=hiddenPassword])"):
                try:
                    el = page.locator(sel).first
                    if el.count() and el.is_visible():
                        el.fill(pw)
                        filled = True
                        break
                except Exception:
                    continue
            if filled:
                for sel in ("#passwordNext", "button:has-text('Далее')", "button:has-text('Next')"):
                    try:
                        el = page.locator(sel).first
                        if el.count() and el.is_visible():
                            el.click(timeout=6000)
                            break
                    except Exception:
                        continue
                page.wait_for_timeout(7000)
                continue

            # speedbump / consent
            hit = None
            for nm in ("Понятно", "I understand", "Продолжить", "Continue",
                       "Разрешить", "Allow", "Принять", "Accept"):
                try:
                    el = page.get_by_role("button", name=nm, exact=False).first
                    if el.count() and el.is_visible():
                        el.click(timeout=6000)
                        hit = nm
                        break
                except Exception:
                    continue
            D.log(f"  [r{r}] {url[:70]} consent={hit} txt={low[:70]!r}")
            last_txt = low
            page.wait_for_timeout(5000)
            continue

        # ушли не туда — начинаем контур заново
        D.log(f"  [r{r}] off-flow {url[:70]}")
        page.goto(D.OAUTH_START, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(3000)
    return "TIMEOUT:" + last_txt[:80]


def one(email, pw, proxy=None, headless=False, keep_profile=False):
    tag = re.sub(r"[^a-z0-9]", "", email.split("@")[0].lower())[-16:]
    prof = os.path.join(PROF_ROOT, tag)
    os.makedirs(prof, exist_ok=True)
    launch = {
        "user_data_dir": prof,
        "headless": headless,
        "args": ["--disable-blink-features=AutomationControlled",
                 "--disable-dev-shm-usage", "--disable-gpu"],
        "viewport": {"width": 1280, "height": 900},
        "executable_path": D.CHROME if os.path.exists(D.CHROME) else None,
    }
    launch = {k: v for k, v in launch.items() if v is not None}
    if proxy:
        launch["proxy"] = {"server": proxy}

    res = {"email": email, "pw": pw, "ts": int(time.time())}
    with sync_playwright() as p:
        try:
            ctx = p.chromium.launch_persistent_context(**launch)
        except Exception as e:
            res["stage"] = "launch_err:" + str(e)[:100]
            D.append_bank(res)
            return res
        try:
            pg = ctx.pages[0] if ctx.pages else ctx.new_page()
            pg.goto(D.OAUTH_START, wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_timeout(2500)
            res["stage"] = oauth_flow(pg, email, pw)
            res["url"] = pg.url[:180]
            try:
                res["txt"] = re.sub(r"\s+", " ", pg.inner_text("body"))[:180]
            except Exception:
                pass
            res["cookies"] = [
                {"name": c["name"], "value": c["value"], "domain": c["domain"]}
                for c in ctx.cookies() if "deepai" in c.get("domain", "")
            ]
        except Exception as e:
            res["stage"] = "exc:" + str(e)[:140]
        finally:
            try:
                ctx.close()
            except Exception:
                pass

    if res.get("stage") == "ok" and res.get("cookies"):
        machine = D.machine_header(salt=email)
        res["machine"] = machine
        s = D.session_from(res)
        st, body = D.theos(s, machine)
        res["theos_status"] = st
        res["theos"] = body if isinstance(body, dict) else str(body)[:200]
        res["ok"] = st == 200 and isinstance(body, dict) and body.get("enabled")
    D.append_bank(res)
    return res


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    proxy = sys.argv[sys.argv.index("--proxy") + 1] if "--proxy" in sys.argv else None
    r = one(args[0], args[1], proxy, "--headless" in sys.argv)
    slim = {k: v for k, v in r.items() if k != "cookies"}
    D.log("RESULT", json.dumps(slim, ensure_ascii=False)[:600])