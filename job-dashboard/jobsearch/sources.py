"""Job sources. Each fetcher returns a list of dicts with the same keys (see `job()`).

Only official APIs, public RSS feeds and public company job-board APIs are used: no logins, no scraping of
sites that forbid it (LinkedIn, Indeed).
"""
import base64
import json
import os
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

UA = "Mozilla/5.0 (compatible; personal-job-search/1.0; +https://github.com)"


def get(url, headers=None, tries=3, as_json=True):
    hdrs = {"User-Agent": UA, "Accept": "application/json, application/xml, text/xml, */*"}
    hdrs.update(headers or {})
    last = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdrs), timeout=30) as r:
                body = r.read().decode("utf-8", "replace")
            return json.loads(body) if as_json else body
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 401, 403, 404):
                break
        except Exception as e:  # network hiccup, bad JSON
            last = e
        time.sleep(2 ** attempt)
    raise RuntimeError(f"{url.split('?')[0]}: {last}")


def iso(value):
    """Epoch seconds / ISO string -> ISO-8601 UTC string."""
    if value in (None, "", 0):
        return None
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            v = float(value)
            if v > 1e12:
                v /= 1000
            return datetime.fromtimestamp(v, timezone.utc).isoformat()
        s = str(value).replace("Z", "+00:00")
        try:
            d = datetime.fromisoformat(s)
        except ValueError:
            from email.utils import parsedate_to_datetime
            d = parsedate_to_datetime(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc).isoformat()
    except Exception:
        return None


def job(source, title, company, url, location="", remote=False, job_type="", description="", posted=None,
        salary_text="", sal_min=None, sal_max=None, sal_currency=None, sal_period=None, tags=None):
    return {
        "source": source, "title": (title or "").strip(), "company": (company or "").strip(), "url": url,
        "location": location or "", "remote": bool(remote), "job_type": job_type or "",
        "description": description or "", "posted": iso(posted), "salary_text": salary_text or "",
        "sal_min": sal_min, "sal_max": sal_max, "sal_currency": sal_currency, "sal_period": sal_period,
        "tags": tags or [],
    }


def _num(v):
    try:
        v = float(v)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- remote job boards

def remotive(profile):
    data = get("https://remotive.com/api/remote-jobs")
    return [job("Remotive", j["title"], j["company_name"], j["url"], j.get("candidate_required_location") or "",
                True, j.get("job_type", ""), j.get("description", ""), j.get("publication_date"),
                salary_text=j.get("salary", ""), tags=j.get("tags") or [])
            for j in data.get("jobs", [])]


def remoteok(profile):
    data = get("https://remoteok.com/api")
    out = []
    for j in data[1:]:
        if not j.get("position"):
            continue
        out.append(job("RemoteOK", j["position"], j.get("company"), j.get("url") or j.get("apply_url"),
                       j.get("location") or "", True, "", j.get("description", ""), j.get("epoch") or j.get("date"),
                       sal_min=_num(j.get("salary_min")), sal_max=_num(j.get("salary_max")), sal_currency="USD",
                       sal_period="year", tags=j.get("tags") or []))
    return out


def himalayas(profile):
    """Search API, limited to jobs open to people living in the UK."""
    out = []
    for q in profile["search_terms"]:
        for page in (1, 2):
            url = "https://himalayas.app/jobs/api/search?" + urllib.parse.urlencode(
                {"q": q, "country": "GB", "page": page})
            try:
                data = get(url)
            except RuntimeError:
                break
            for j in data.get("jobs", []):
                locs = j.get("locationRestrictions") or []
                if len(locs) > 6:
                    locs = [("United Kingdom + " if "United Kingdom" in locs else "") + f"{len(locs)} countries"]
                out.append(job("Himalayas", j.get("title"), j.get("companyName"),
                               j.get("applicationLink") or j.get("guid"), ", ".join(locs) or "Worldwide", True,
                               j.get("employmentType", ""), j.get("description") or j.get("excerpt", ""),
                               j.get("pubDate"), sal_min=_num(j.get("minSalary")), sal_max=_num(j.get("maxSalary")),
                               sal_currency=j.get("currency"), sal_period=j.get("salaryPeriod") or "year",
                               tags=j.get("categories") or []))
            if len(data.get("jobs", [])) < 20:
                break
            time.sleep(0.5)
    return out


def jobicy(profile):
    out = []
    for geo in ("uk", "europe", "emea", "poland", "ireland"):
        try:
            data = get(f"https://jobicy.com/api/v2/remote-jobs?count=100&geo={geo}")
        except RuntimeError:
            continue
        for j in data.get("jobs", []):
            out.append(job("Jobicy", j.get("jobTitle"), j.get("companyName"), j.get("url"), j.get("jobGeo", ""),
                           True, " ".join(j.get("jobType") or []), j.get("jobDescription") or j.get("jobExcerpt", ""),
                           j.get("pubDate"), sal_min=_num(j.get("salaryMin")), sal_max=_num(j.get("salaryMax")),
                           sal_currency=j.get("salaryCurrency"), sal_period=j.get("salaryPeriod"),
                           tags=j.get("jobIndustry") or []))
    return out


def arbeitnow(profile):
    out = []
    for page in (1, 2, 3):
        data = get(f"https://www.arbeitnow.com/api/job-board-api?page={page}")
        for j in data.get("data", []):
            if not j.get("remote"):
                continue  # onsite jobs in Germany are no use
            out.append(job("Arbeitnow", j.get("title"), j.get("company_name"), j.get("url"),
                           j.get("location", ""), True, " ".join(j.get("job_types") or []),
                           j.get("description", ""), j.get("created_at"), tags=j.get("tags") or []))
    return out


def weworkremotely(profile):
    feeds = ["remote-customer-support-jobs", "remote-sales-and-marketing-jobs", "remote-devops-sysadmin-jobs",
             "all-other-remote-jobs"]
    out = []
    for f in feeds:
        try:
            xml = get(f"https://weworkremotely.com/categories/{f}.rss", as_json=False)
        except RuntimeError:
            continue
        root = ET.fromstring(xml)
        for item in root.iter("item"):
            g = lambda tag: (item.findtext(tag) or "").strip()
            company, _, title = g("title").partition(": ")
            if not title:
                company, title = "", company
            loc = ", ".join(x for x in (g("region"), g("country")) if x)
            out.append(job("We Work Remotely", title, company, g("link"), loc, True, g("type"),
                           g("description"), g("pubDate")))
    return out


def workingnomads(profile):
    data = get("https://www.workingnomads.com/api/exposed_jobs/")
    return [job("Working Nomads", j.get("title"), j.get("company_name"), j.get("url"), j.get("location", ""), True,
                "", j.get("description", ""), j.get("pub_date"), tags=(j.get("tags") or "").split(","))
            for j in data]


# ---------------------------------------------------------------- keyed APIs (optional)

def adzuna(profile):
    """UK jobs incl. Belfast/Lisburn area. Needs ADZUNA_APP_ID / ADZUNA_APP_KEY. Capped by ADZUNA_MAX_CALLS."""
    app_id, app_key = os.environ.get("ADZUNA_APP_ID"), os.environ.get("ADZUNA_APP_KEY")
    if not (app_id and app_key):
        return None  # not configured
    max_calls = int(os.environ.get("ADZUNA_MAX_CALLS", "4"))
    what_or = "support technician helpdesk desk engineer analyst customer sales administrator ict"
    queries = [
        {"where": "Northern Ireland", "what_or": what_or, "page": 1},
        {"what": "remote", "what_or": what_or, "page": 1},
        {"where": "Northern Ireland", "what_or": what_or, "page": 2},
        {"what": "remote", "what_or": what_or, "page": 2},
    ][:max_calls]
    out = []
    from .classify import REMOTE_RE, HYBRID_RE, ONSITE_RE
    for q in queries:
        page = q.pop("page")
        remote_query = q.get("what") == "remote"
        params = {"app_id": app_id, "app_key": app_key, "results_per_page": 50, "max_days_old": 30,
                  "sort_by": "date", "content-type": "application/json", **q}
        data = get(f"https://api.adzuna.com/v1/api/jobs/gb/search/{page}?" + urllib.parse.urlencode(params),
                   tries=1)
        for j in data.get("results", []):
            loc = (j.get("location") or {}).get("display_name", "")
            text = f"{j.get('title', '')} {j.get('description', '')}"
            remote = remote_query and bool(REMOTE_RE.search(text)) and not (HYBRID_RE.search(text) or ONSITE_RE.search(text))
            # Adzuna sometimes annualises hourly pay twice (e.g. £13.20/h -> £171,600); treat those as unknown
            predicted = str(j.get("salary_is_predicted")) == "1" or (j.get("salary_min") or 0) >= 100000
            out.append(job("Adzuna", j.get("title"), (j.get("company") or {}).get("display_name"),
                           j.get("redirect_url"), loc, remote,
                           f"{j.get('contract_type', '')} {j.get('contract_time', '')}", j.get("description", ""),
                           j.get("created"), sal_min=None if predicted else _num(j.get("salary_min")),
                           sal_max=None if predicted else _num(j.get("salary_max")), sal_currency="GBP",
                           sal_period="year"))
    return out


def reed(profile):
    """reed.co.uk API (free key from reed.co.uk/developers). Needs REED_API_KEY."""
    key = os.environ.get("REED_API_KEY")
    if not key:
        return None
    auth = {"Authorization": "Basic " + base64.b64encode(f"{key}:".encode()).decode()}
    out = []
    for params in ({"locationName": "Belfast", "distanceFromLocation": 25},
                   {"keywords": "remote", "locationName": "United Kingdom"}):
        for kw in ("IT support", "service desk", "technical support", "customer success", "sales"):
            p = dict(params)
            p["keywords"] = (p.get("keywords", "") + " " + kw).strip()
            p["minimumSalary"] = 28000
            p["resultsToTake"] = 100
            data = get("https://www.reed.co.uk/api/1.0/search?" + urllib.parse.urlencode(p), headers=auth)
            for j in data.get("results", []):
                out.append(job("Reed", j.get("jobTitle"), j.get("employerName"), j.get("jobUrl"),
                               j.get("locationName", ""), False, "", j.get("jobDescription", ""), j.get("date"),
                               sal_min=_num(j.get("minimumSalary")), sal_max=_num(j.get("maximumSalary")),
                               sal_currency=j.get("currency") or "GBP", sal_period="year"))
    return out


# ---------------------------------------------------------------- company careers pages

def greenhouse(slug):
    data = get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    return [job("Careers page", j["title"], j.get("company_name") or slug.title(), j["absolute_url"],
                (j.get("location") or {}).get("name", ""), False, "", "", j.get("first_published") or j.get("updated_at"))
            for j in data.get("jobs", [])]


def lever(slug):
    data = get(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    out = []
    for j in data:
        cats = j.get("categories") or {}
        locs = ", ".join(cats.get("allLocations") or [cats.get("location") or ""])
        sr = j.get("salaryRange") or {}
        if j.get("workplaceType") == "hybrid":
            locs += " (Hybrid)"
        out.append(job("Careers page", j.get("text"), slug.title(), j.get("hostedUrl"), locs,
                       j.get("workplaceType") == "remote", cats.get("commitment", ""), j.get("descriptionPlain", ""),
                       j.get("createdAt"), sal_min=_num(sr.get("min")), sal_max=_num(sr.get("max")),
                       sal_currency=sr.get("currency"),
                       sal_period={"per-year-salary": "year", "per-month-salary": "month",
                                   "per-hour-wage": "hour"}.get(sr.get("interval"), "year")))
    return out


def ashby(slug):
    data = get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true")
    out = []
    for j in data.get("jobs", []):
        if not j.get("isListed", True):
            continue
        locs = [j.get("location") or ""] + [s.get("location", "") for s in j.get("secondaryLocations") or []]
        comp = (j.get("compensation") or {}).get("scrapeableCompensationSalarySummary") or ""
        mode = j.get("workplaceType") or ("Remote" if j.get("isRemote") else "")
        where = ", ".join(filter(None, locs)) + (f" ({mode})" if mode in ("Hybrid", "Remote") else "")
        out.append(job("Careers page", j.get("title"), slug.title(), j.get("jobUrl"), where,
                       mode == "Remote", j.get("employmentType", ""),
                       j.get("descriptionPlain", ""), j.get("publishedAt"), salary_text=comp))
    return out


def smartrecruiters(slug):
    data = get(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100")
    out = []
    for j in data.get("content", []):
        loc = j.get("location") or {}
        where = ", ".join(filter(None, [loc.get("city"), loc.get("region"), loc.get("country", "").upper()]))
        if loc.get("hybrid"):
            where += " (Hybrid)"
        out.append(job("Careers page", j.get("name"), (j.get("company") or {}).get("name") or slug,
                       f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}", where,
                       bool(loc.get("remote")), (j.get("typeOfEmployment") or {}).get("label", ""), "",
                       j.get("releasedDate")))
    return out


BOARD_FETCHERS = {"greenhouse": greenhouse, "lever": lever, "ashby": ashby, "smartrecruiters": smartrecruiters}

FEEDS = {
    "Remotive": remotive, "RemoteOK": remoteok, "Himalayas": himalayas, "Jobicy": jobicy, "Arbeitnow": arbeitnow,
    "We Work Remotely": weworkremotely, "Working Nomads": workingnomads, "Adzuna": adzuna, "Reed": reed,
}
