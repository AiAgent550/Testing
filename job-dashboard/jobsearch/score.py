"""Decide whether a job is worth showing, and how well it fits the CV (0-100, with reasons)."""
import hashlib
import re
from datetime import datetime, timezone

from . import classify as C

ELIG_HINT_RE = re.compile(
    r"(?:based in|located in|living in|reside in|resident in|residents of|anywhere in|within|eligible to work in|"
    r"right to work in|open to candidates in|hiring in|remote in|remote from)\s(?:the\s)?(.{0,60})", re.I)


def job_key(company, title):
    norm = lambda s: re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
    return f"{norm(company)}|{norm(title)}"


def job_id(key):
    return hashlib.sha1(key.encode()).hexdigest()[:10]


def _family(title, profile):
    best = None
    for name, fam in profile["families"].items():
        if C.any_term(title, fam["titles"]) and (best is None or fam["points"] > best[1]["points"]):
            best = (name, fam)
    return best


def _salary(raw, profile):
    rates = profile["currency_to_gbp"]
    cur = (raw.get("sal_currency") or "").upper() or None
    if raw.get("sal_min") or raw.get("sal_max"):
        if cur in rates:
            lo = raw.get("sal_min") or raw.get("sal_max")
            hi = raw.get("sal_max") or lo
            period = (raw.get("sal_period") or "year").lower()
            period = next((p for p in C.ANNUAL if p in period), None) or C._guess_period("", lo)
            mult = C.ANNUAL[period] * rates[cur]
            lo_g, hi_g = round(lo * mult), round(hi * mult)
            if 8000 <= lo_g <= 800000:
                return lo_g, hi_g, period
    if raw.get("salary_text"):
        found = C.parse_salary(raw["salary_text"], rates, default_currency=cur)
        if found:
            return found
    return C.parse_salary(raw.get("_desc", "")[:4000], rates)


def _age_days(iso_str, now):
    if not iso_str:
        return None
    try:
        return (now - datetime.fromisoformat(iso_str)).total_seconds() / 86400
    except ValueError:
        return None


def evaluate(raw, profile, now=None):
    """Return a scored job dict, or None if it should not be shown."""
    now = now or datetime.now(timezone.utc)
    title = raw["title"]
    if not title or not raw.get("url"):
        return None
    t = title.lower()
    desc = C.plain(raw["description"])[:8000]
    raw["_desc"] = desc
    d = desc.lower()
    loc = C.plain(raw["location"])

    family = _family(t, profile)
    if C.any_term(t, profile["exclude_titles"]) and not (family and family[0] == "it_support"):
        return None

    mode = C.work_mode(loc, title, d, raw["remote"], profile["hybrid_places"])
    if mode == "other":
        return None

    reasons, flags = [], []
    score = 0

    # --- where it can be done from
    if mode == "ni":
        elig, note = "uk", ""
        score += 12
        reasons.append("Commutable from Dungannon (Belfast/Lisburn area)")
        if not C.HYBRID_RE.search(loc + " " + title + " " + d[:3000]):
            flags.append("Check if hybrid or fully onsite")
    else:
        elig, note = C.eligibility(loc)
        if elig == "unknown":
            for m in ELIG_HINT_RE.finditer(desc[:5000]):
                e2, n2 = C.eligibility(m.group(1))
                if e2 != "unknown":
                    elig, note = e2, n2
                    break
        if elig == "none":
            return None
        score += {"uk": 15, "region": 12, "unknown": 3, "country": -10}[elig]
        reasons.append({"uk": "Open to UK residents", "region": "Open across Europe / worldwide",
                        "unknown": "Remote; location rules not stated", "country": note}[elig])
        if elig == "unknown":
            flags.append("Confirm they hire from the UK")
        if elig == "country":
            flags.append(note)

    if mode == "remote" and re.search(r"\bfield\b|on[- ]?site|mobile engineer", t):
        flags.append("Field-based: check which area it covers")

    # --- salary
    sal = _salary(raw, profile)
    lo, hi, period = sal if sal else (None, None, None)
    status = C.salary_status(lo, hi, profile["min_salary_gbp"])
    if status == "below":
        return None
    if status == "meets":
        score += 15 if lo >= 40000 else 10
    elif status == "borderline":
        score += 2
        flags.append("Salary range starts below £30k")
    else:
        flags.append("Salary not stated")

    # --- role fit
    if family:
        score += family[1]["points"]
        reasons.append(f"{family[1]['label']} role")
        fam_name = family[0]
    else:
        fam_name = "other"
        score += 12
    skills = C.any_term(d + " " + t, profile["skills"])
    if skills:
        score += min(18, 3 * len(skills))
        reasons.append("Uses your skills: " + ", ".join(skills[:6]))

    # --- language
    bonus, need = C.language_needs(title, desc, profile["bonus_languages"], profile["other_languages"])
    if bonus:
        score += 18
        reasons.append("Polish speakers wanted")
        if fam_name == "other":
            fam_name = "polish"
    need = [l for l in need if l not in bonus]
    if need:
        score -= 35
        flags.append("Needs " + ", ".join(l.title() for l in need[:3]))
    if C.is_german_posting(desc[:3000]):
        score -= 25
        flags.append("Advert written in German")

    # --- seniority
    senior = C.any_term(t, profile["senior_words"])
    if C.any_term(t, profile["manager_ok"]):
        senior = [w for w in senior if w != "manager"]
    if senior:
        score -= 15
        flags.append("Senior level")
    elif C.any_term(t, profile["junior_words"]):
        score += 6

    # --- contract / part time
    contract = C.is_contract(raw["job_type"], title)
    part_time = C.is_part_time(raw["job_type"], title)
    if contract:
        if lo and lo >= profile["good_contract_min_gbp"]:
            reasons.append("Contract, but well paid")
        else:
            score -= 15
            flags.append("Contract / temporary")
    if C.COMMISSION_RE.search(t + " " + d[:3000]):
        score -= 40
        flags.append("Commission only")
    if part_time:
        score -= 15
        flags.append("Part-time")

    # --- freshness
    age = _age_days(raw["posted"], now)
    if age is not None:
        if age > profile["max_age_days"]:
            return None
        if age <= 2:
            score += 6
        elif age <= 7:
            score += 3
        elif age > 30:
            score -= 8

    score = max(0, min(100, score))
    if score < profile["min_score"]:
        return None
    key = job_key(raw["company"], title)
    snippet = desc[:320] + ("…" if len(desc) > 320 else "")
    return {
        "id": job_id(key), "key": key, "title": title, "company": raw["company"] or "Unknown company",
        "url": raw["url"], "sources": [raw["source"]], "location": loc[:140] or ("Remote" if mode == "remote" else ""),
        "mode": mode, "elig": elig, "family": fam_name,
        "salary": {"lo": lo, "hi": hi, "period": period, "status": status},
        "contract": contract, "part_time": part_time, "score": score,
        "priority": "P1" if score >= 70 else "P2" if score >= 55 else "P3" if score >= 40 else "P4",
        "reasons": reasons, "flags": flags, "posted": raw["posted"], "snippet": snippet,
        "_dupe": f"{key.split('|')[0]}|{desc[:160].lower()}" if len(desc) > 80 else key,
        "_richness": (lo is not None) * 2 + min(len(desc), 4000) / 4000,
    }
