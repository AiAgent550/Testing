"""Turn raw job text into facts: salary in GBP, where it can be done from, contract or not, language needs."""
import html
import re

# ---------------------------------------------------------------- text helpers

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def plain(text):
    """Strip HTML and collapse whitespace."""
    if not text:
        return ""
    text = html.unescape(TAG_RE.sub(" ", str(text)))
    return WS_RE.sub(" ", text).strip()


def has_term(text, term):
    """Whole-word(ish) match: 'sdr' must not match inside 'sdrive', 'it support' must match 'IT Support'."""
    return re.search(r"(?<![a-z0-9])" + re.escape(term.strip()) + r"(?![a-z0-9])", text) is not None


def any_term(text, terms):
    return [t for t in terms if has_term(text, t)]


# ---------------------------------------------------------------- salary

SYMBOLS = {"£": "GBP", "€": "EUR", "$": "USD", "zł": "PLN", "zl": "PLN"}
CODES = ["GBP", "EUR", "USD", "PLN", "CHF", "SEK", "NOK", "DKK", "CZK", "HUF", "RON", "CAD", "AUD", "NZD", "INR"]
CUR = r"(?:£|€|\$|zł|" + "|".join(CODES) + r")"
NUM = r"\d{1,3}(?:[,.  ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
AMOUNT = rf"(?P<c1>{CUR})?\s?(?P<n1>{NUM})\s?(?P<k1>[kK])?\s?(?P<c1b>{CUR})?"
RANGE_RE = re.compile(
    AMOUNT + rf"(?:\s?(?:-|–|—|to)\s?(?P<c2>{CUR})?\s?(?P<n2>{NUM})\s?(?P<k2>[kK])?\s?(?P<c2b>{CUR})?)?",
    re.IGNORECASE,
)
PERIODS = [
    ("hour", re.compile(r"(?:per|an|/|a)\s?(?:hour|hr)\b|hourly|p/?h\b", re.I)),
    ("day", re.compile(r"(?:per|a|/)\s?day\b|daily|day rate|p/?d\b", re.I)),
    ("month", re.compile(r"(?:per|a|/)\s?(?:month|mo)\b|monthly|brutto|netto|/m\b", re.I)),
    ("year", re.compile(r"(?:per|a|/)\s?(?:year|yr|annum)\b|annual|yearly|p\.?a\.?\b|ote\b", re.I)),
]
ANNUAL = {"hour": 1950, "day": 225, "month": 12, "year": 1}


def _num(raw, k):
    raw = raw.replace(" ", " ")
    # "45.000" / "45,000" / "45 000" are thousands; "12.50" is a decimal
    if re.fullmatch(r"\d{1,3}(?:[,. ]\d{3})+", raw):
        val = float(re.sub(r"[,. ]", "", raw))
    else:
        val = float(raw.replace(",", ""))
    return val * 1000 if k else val


def _currency(token):
    if not token:
        return None
    t = token.strip()
    return SYMBOLS.get(t.lower(), SYMBOLS.get(t, t.upper()))


def _guess_period(context, value):
    for name, rx in PERIODS:
        if rx.search(context):
            return name
    # No period word: infer from magnitude
    if value < 200:
        return "hour"
    if value < 1500:
        return "day"
    if value < 12000:
        return "month"
    return "year"


def parse_salary(text, rates, default_currency=None):
    """Find the first plausible salary in text. Returns (min_gbp, max_gbp, period) or None.

    A currency must be present (symbol, code, or default_currency for structured salary fields),
    so random numbers in descriptions ('5 years', '24/7') are ignored.
    """
    if not text:
        return None
    for m in RANGE_RE.finditer(text):
        cur = _currency(m.group("c1") or m.group("c1b") or m.group("c2") or m.group("c2b")) or default_currency
        if not cur or cur not in rates:
            continue
        try:
            lo = _num(m.group("n1"), m.group("k1") or m.group("k2"))
            hi = _num(m.group("n2"), m.group("k2") or m.group("k1")) if m.group("n2") else lo
        except ValueError:
            continue
        if lo <= 0:
            continue
        if hi < lo:
            lo, hi = hi, lo
        context = text[m.start(): m.end() + 30]
        period = _guess_period(context, lo)
        lo_gbp = lo * ANNUAL[period] * rates[cur]
        hi_gbp = hi * ANNUAL[period] * rates[cur]
        if 8000 <= lo_gbp <= 500000 and hi_gbp <= 800000:
            return round(lo_gbp), round(hi_gbp), period
    return None


def salary_status(lo, hi, minimum):
    if hi is None:
        return "unknown"
    if lo >= minimum:
        return "meets"
    if hi >= minimum:
        return "borderline"
    return "below"


# ---------------------------------------------------------------- location / eligibility

REGION_OK = ["worldwide", "anywhere", "global", "globally", "international", "europe", "european", "emea", "eu", "eea",
             "cet", "cest", "gmt", "bst", "utc+0", "utc+1", "utc+2", "utc +0", "utc +1", "europe/emea", "remote - emea",
             "remote europe"]
UK_OK = ["uk", "united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland",
         "gb", "london", "manchester", "birmingham", "leeds", "glasgow", "edinburgh", "bristol", "belfast"]
COUNTRY_EU = ["ireland", "poland", "germany", "france", "spain", "portugal", "netherlands", "belgium", "austria",
              "italy", "sweden", "denmark", "finland", "norway", "switzerland", "czech", "czechia", "slovakia",
              "hungary", "romania", "bulgaria", "greece", "croatia", "slovenia", "estonia", "latvia", "lithuania",
              "luxembourg", "malta", "cyprus", "iceland", "warsaw", "krakow", "kraków", "wroclaw", "wrocław",
              "gdansk", "gdańsk", "poznan", "poznań", "lodz", "łódź", "dublin", "cork", "berlin", "munich",
              "amsterdam", "lisbon", "porto", "madrid", "barcelona", "paris", "prague", "budapest", "bucharest",
              "vienna", "stockholm", "copenhagen", "helsinki", "oslo", "zurich", "athens", "tallinn", "riga", "vilnius"]
ELSEWHERE = ["united states", "usa", "us", "u.s.", "us only", "america", "americas", "north america", "canada",
             "latam", "latin america", "south america", "mexico", "brazil", "argentina", "colombia", "chile", "peru",
             "apac", "asia", "india", "philippines", "singapore", "japan", "australia", "new zealand", "china",
             "africa", "nigeria", "kenya", "south africa", "egypt", "israel", "uae", "dubai", "saudi", "pakistan",
             "vietnam", "indonesia", "malaysia", "thailand", "korea", "taiwan", "hong kong", "turkey", "est", "pst",
             "cst", "et", "pt", "new york", "san francisco", "california", "texas", "toronto", "vancouver"]

POLAND_IRELAND_NOTE = {"poland": "Poland-based: you can work there as an EU citizen, but would need to live there",
                       "ireland": "Ireland-based: usually means living in the Republic"}


def eligibility(location_text):
    """Where can the job be done from, from Michal's point of view (UK resident with EU citizenship).

    Returns (level, note):
      uk       - UK / Northern Ireland explicitly allowed
      region   - Worldwide / Europe / EMEA / EU wide
      country  - one specific European country only (normally means living there)
      none     - only non-European locations
      unknown  - nothing stated
    """
    t = (location_text or "").lower()
    if not t.strip() or t.strip() in {"remote", "remote job", "fully remote", "100% remote", "home based", "anywhere?"}:
        return "unknown", ""
    if any_term(t, UK_OK):
        return "uk", ""
    if any_term(t, REGION_OK):
        return "region", ""
    eu = any_term(t, COUNTRY_EU)
    if eu:
        place = eu[0]
        return "country", POLAND_IRELAND_NOTE.get(place, f"Listed for {place.title()} only: usually means living there")
    if any_term(t, ELSEWHERE):
        return "none", ""
    return "unknown", ""


def near_home(location_text, places):
    t = (location_text or "").lower()
    return bool(any_term(t, places))


REMOTE_RE = re.compile(r"\bremote\b|work from home|wfh|home[- ]based|anywhere|distributed|telecommut", re.I)
HYBRID_RE = re.compile(r"\bhybrid\b", re.I)
ONSITE_RE = re.compile(r"\bon[- ]?site\b|\bin[- ]office\b|office[- ]based", re.I)


def work_mode(location_text, title, description, remote_flag, places):
    """'remote', 'ni' (hybrid/onsite near Belfast-Lisburn-Dungannon) or 'other' (onsite elsewhere: dropped)."""
    loc = location_text or ""
    local = near_home(loc, places)
    if remote_flag or REMOTE_RE.search(loc) or REMOTE_RE.search(title):
        return "ni" if local and HYBRID_RE.search(loc + " " + title) else "remote"
    return "ni" if local else "other"


# ---------------------------------------------------------------- contract, language, German postings

CONTRACT_RE = re.compile(r"\bcontract(?:or)?\b|\bfreelanc|\btemporary\b|\btemp\b|fixed[- ]term|\bftc\b|\bb2b\b|"
                         r"\b\d+[- ]?months?\b(?= contract)|\binterim\b|\bper diem\b", re.I)
PARTTIME_RE = re.compile(r"part[- ]time|spare time|side hustle", re.I)
COMMISSION_RE = re.compile(r"commission[- ]only|commission based only|unpaid", re.I)


def is_contract(job_type, title):
    text = f"{job_type or ''} {title or ''}"
    if re.search(r"full[- ]time|permanent", job_type or "", re.I) and not re.search(r"contract|freelanc", title or "", re.I):
        return False
    return bool(CONTRACT_RE.search(text))


def is_part_time(job_type, title):
    return bool(PARTTIME_RE.search(f"{job_type or ''} {title or ''}"))


def language_needs(title, description, bonus, others):
    """Return (bonus_hits, required_other_languages)."""
    t = title.lower()
    d = description.lower()
    bonus_hits = [l for l in bonus if has_term(t, l) or re.search(
        rf"{l}[- ](?:speak|speaking|speaker|language)|(?:fluent|native|fluency)\s(?:in\s)?(?:\w+\s(?:and|&|or)\s)?{l}|{l}\s(?:is|as)\s(?:a\s)?(?:must|required|plus)", d)]
    need = []
    for l in others:
        if has_term(t, l):
            need.append(l)
        elif re.search(rf"(?:fluent|native|fluency|business[- ]level|proficien\w*|c1|c2)\s(?:in\s)?(?:english\s(?:and|&)\s)?{l}\b|"
                       rf"\b{l}[- ](?:speaking|speaker)|\b{l}\s(?:is\s)?(?:required|mandatory|essential|a must)", d):
            need.append(l)
    return bonus_hits, need


GERMAN_WORDS = re.compile(r"\b(?:und|die|der|wir|mit|für|sie|bei|eine|ihre|unsere|aufgaben|kenntnisse)\b", re.I)


def is_german_posting(text):
    words = len(text.split()) or 1
    return len(GERMAN_WORDS.findall(text)) / words > 0.04
