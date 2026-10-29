# Michal's job queue

A daily job search for one person and one CV. It pulls jobs from official job APIs, public feeds and company careers pages. It keeps only jobs that fit Michal's situation and ranks them against his CV. The results go into a single-page dashboard with an application tracker.

**Who it is for:** IT support / field and deskside technician (ICT Services, current role), with Microsoft 365, Active Directory, Windows and server hardware experience. Polish (native) and English (fluent). UK settled status and a Polish passport, so he can work anywhere in the UK or EU.

**What counts as a match**
- Remote jobs open to UK residents, or Europe / EMEA / worldwide. Jobs limited to one other EU country are kept but ranked low, because they usually require living there.
- Hybrid or onsite jobs within commuting distance of Dungannon (Belfast, Lisburn, Craigavon, Portadown, Armagh, Cookstown, Antrim and nearby).
- A salary of at least £30,000 a year. Jobs that don't state a salary are kept and flagged. Ranges that start below £30k but go above it are flagged as borderline. Hourly, daily and monthly rates and foreign currencies are converted to pounds per year.
- Any line of work. IT support ranks highest, then customer and technical support, sales, and ops and admin. Jobs that want Polish speakers get a boost. Jobs that need another language are hidden by default.
- Contracts and part-time work are ranked down unless the pay is £45k a year or more.

## Where the jobs come from

| Source | How | Notes |
|---|---|---|
| Himalayas | Search API, filtered to jobs open to UK residents | Best remote source |
| Jobicy | API, UK / Europe / EMEA / Poland / Ireland | |
| We Work Remotely | RSS feeds (support, sales, sysadmin, other) | |
| RemoteOK, Remotive, Working Nomads, Arbeitnow | Public APIs | Arbeitnow: remote jobs only |
| Adzuna | API, Northern Ireland + UK remote | Needs a free key (see below) |
| Reed | API | Optional, free key from reed.co.uk/developers |
| Company careers pages | Greenhouse, Lever, Ashby and SmartRecruiters job-board APIs | Finds jobs that are never posted on job boards. Edit `config/companies.json` to add companies |

LinkedIn and Indeed are not scraped: both forbid it and block it. Set up job alerts there instead and use this dashboard for everything else.

## Running it

```bash
cd job-dashboard
python -m jobsearch                    # about a minute; writes data/jobs.json and site/index.html
python -m unittest discover -s tests -t .
```

Only the Python 3.10+ standard library is used, so there is nothing to install. Open `site/index.html` in a browser. Your statuses and notes are saved in that browser, and the page has backup and restore.

The GitHub Action in `.github/workflows/job-search.yml` runs the search every morning and commits the new results. You can also start it from the **Actions** tab with **Run workflow**.

## Settings (GitHub → Settings → Secrets and variables → Actions)

| Name | Type | What it does |
|---|---|---|
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Secret | Turns on Adzuna. Never commit these to the repo |
| `ADZUNA_MAX_CALLS` | Variable | Adzuna calls per run (default 2, max 4). The trial plan allows only 25 calls in total, so it runs out after about 10 days. The paid plan allows 500 a day |
| `REED_API_KEY` | Secret | Turns on Reed |
| `PUBLISH_PAGES` | Variable | Set to `true` to publish the dashboard with GitHub Pages (Settings → Pages → Source: GitHub Actions) |

## Tuning

Everything that decides what you see is in `config/profile.json`: the minimum salary, commutable towns, job title keywords for each track, your skills, titles to exclude, and the minimum score. Scores run from 0 to 100. P1 is 70 or more, P2 is 55 or more, P3 is 40 or more.
