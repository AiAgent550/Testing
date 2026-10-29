"""Run the whole search:  python -m jobsearch   (from the job-dashboard folder)

Fetches every source, scores each job against config/profile.json, merges with earlier runs (so jobs keep their
'first seen' date) and writes data/jobs.json plus the self-contained dashboard site/index.html.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import sources
from .score import evaluate, job_key

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "jobs.json"
SITE = ROOT / "site" / "index.html"
TEMPLATE = ROOT / "templates" / "dashboard.html"


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def live_rates(profile):
    """Refresh currency rates from the ECB (via frankfurter); keep the config values if that fails."""
    try:
        data = sources.get("https://api.frankfurter.dev/v1/latest?base=GBP", tries=1)
        for cur, per_gbp in data["rates"].items():
            if cur in profile["currency_to_gbp"] and per_gbp:
                profile["currency_to_gbp"][cur] = round(1 / per_gbp, 5)
        return True
    except Exception:
        return False


def fetch_all(profile, companies):
    tasks = {name: (lambda f=f: f(profile)) for name, f in sources.FEEDS.items()}
    for platform, slugs in companies.items():
        if platform.startswith("_"):
            continue
        for slug in slugs:
            tasks[f"{platform}:{slug}"] = (lambda p=platform, s=slug: sources.BOARD_FETCHERS[p](s))

    results = {}

    def run(name):
        t0 = time.time()
        try:
            out = tasks[name]()
            return name, out, None, time.time() - t0
        except Exception as e:  # one broken source must not stop the run
            return name, [], str(e)[:200], time.time() - t0

    with ThreadPoolExecutor(max_workers=10) as pool:
        for name, out, err, secs in pool.map(run, tasks):
            results[name] = (out, err)
            status = "skipped (no API key)" if out is None else (f"ERROR {err}" if err else f"{len(out)} jobs")
            print(f"  {name:<28} {status}  ({secs:.1f}s)", file=sys.stderr)
    return results


def main():
    profile = load_json(ROOT / "config" / "profile.json", None)
    companies = load_json(ROOT / "config" / "companies.json", {})
    now = datetime.now(timezone.utc)
    rates_live = live_rates(profile)
    print(f"Currency rates: {'live' if rates_live else 'from config'}", file=sys.stderr)

    results = fetch_all(profile, companies)

    best, dupes, seen_raw, source_log = {}, {}, set(), []
    careers = {"name": "Company careers pages", "fetched": 0, "kept": 0, "errors": [], "companies": 0}
    for name, (raw_jobs, err) in results.items():
        kept = 0
        for raw in raw_jobs or []:
            seen_raw.add(job_key(raw["company"], raw["title"]))
            j = evaluate(raw, profile, now)
            if not j:
                continue
            kept += 1
            # same company + same advert text = one job posted for several towns
            j["key"] = dupes.setdefault(j.pop("_dupe"), j["key"])
            prev = best.get(j["key"])
            if prev:
                srcs = sorted(set(prev["sources"]) | set(j["sources"]))
                winner = j if j["_richness"] > prev["_richness"] else prev
                winner["sources"] = srcs
                best[j["key"]] = winner
            else:
                best[j["key"]] = j
        if ":" in name:
            careers["companies"] += 1
            careers["fetched"] += len(raw_jobs or [])
            careers["kept"] += kept
            if err:
                careers["errors"].append(f"{name}: {err}")
        else:
            source_log.append({"name": name, "fetched": None if raw_jobs is None else len(raw_jobs), "kept": kept,
                               "error": err, "skipped": raw_jobs is None and not err})
    careers["error"] = "; ".join(careers.pop("errors"))[:300] or None
    source_log.append(careers)

    # One advert copied for many towns (same company, role type and pay): keep the best two
    groups = {}
    for key, j in best.items():
        groups.setdefault((j["company"].lower(), j["family"], j["salary"]["lo"], j["salary"]["hi"], j["mode"]), []).append(key)
    for keys in groups.values():
        if len(keys) > 3:
            keys.sort(key=lambda k: -best[k]["score"])
            best[keys[0]]["flags"].append(f"Also posted for {len(keys) - 1} other locations")
            for k in keys[2:]:
                del best[k]

    # Merge with the previous run: keep first-seen dates, and keep recent jobs that dropped out of a feed's window
    previous = {j["key"]: j for j in load_json(DATA, {}).get("jobs", [])}
    stamp = now.isoformat()
    cutoff = now - timedelta(days=profile["max_age_days"])
    jobs = []
    for key, j in best.items():
        j.pop("_richness", None)
        j["first_seen"] = previous.get(key, {}).get("first_seen", stamp)
        j["last_seen"] = stamp
        jobs.append(j)
    for key, j in previous.items():
        if key in best or key in seen_raw:
            continue  # still listed (maybe filtered out now): only keep jobs that fell out of a feed's window
        try:
            last = datetime.fromisoformat(j.get("last_seen", stamp))
        except ValueError:
            continue
        if last > now - timedelta(days=7) and datetime.fromisoformat(j.get("first_seen", stamp)) > cutoff:
            jobs.append(j)

    jobs.sort(key=lambda j: (-j["score"], j.get("posted") or ""), reverse=False)
    out = {"generated": stamp, "min_salary_gbp": profile["min_salary_gbp"], "home": profile["home"],
           "rates_live": rates_live, "sources": source_log, "jobs": jobs}
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(json.dumps(out, ensure_ascii=False, indent=1))

    page = "<!doctype html>\n<html lang=\"en\">\n" + TEMPLATE.read_text().replace(
        "/*__JOBS_JSON__*/null", json.dumps(out, ensure_ascii=False).replace("</", "<\\/"))
    SITE.parent.mkdir(parents=True, exist_ok=True)
    SITE.write_text(page)
    new = sum(1 for j in jobs if j["first_seen"] == stamp)
    print(f"\n{len(jobs)} jobs kept ({new} new). Wrote {DATA.relative_to(ROOT)} and {SITE.relative_to(ROOT)}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
