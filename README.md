# VO-AI — Variation Order Intelligence

A decision-support prototype for construction Variation Order management, built for the
"海之子"杯 AI智能体挑战计划 by Team GUD GUD.

**Live demo:** https://cytang1107.github.io/VO-AI/

## Running locally

No build step and no dependencies. Serve the folder over HTTP:

```bash
python -m http.server 8080
```

Then open http://localhost:8080/. Opening `index.html` directly from the filesystem also
works, but serving it over HTTP matches the deployed behaviour.

## Signing in

There are no passwords — pick a name and a role:

| Role | What it can do |
|---|---|
| Contractor QS | Raise a VO, enter measurement, submit it |
| Consultant QS | Create projects, upload the BQ, cross-check rates, approve |
| Client / Developer | Certify the final price and track every VO |

"Restore demo data" on the Projects page resets everything to the seeded scenario.

## Tests

```bash
node --test
```

## How it works

All state lives in your browser's `localStorage` under `voai.db.v1` — nothing is sent
anywhere. The analysis engine (`js/analysis.js`) is deterministic and rule-based: it
classifies the change, looks the governing clause up in `js/clauses.js`, and cross-checks
every claimed rate against the priced contract BQ. There is no language model in this
build, and no figure shown in the UI is invented — see
`docs/superpowers/specs/2026-08-24-vo-ai-spec.md` §5.

## Deploying

The site is published from `main` at
**https://cytang1107.github.io/VO-AI/**

It is a static site with no build step, so any push to `main` republishes it within about a
minute. To point a fork at your own GitHub Pages, go to **Settings > Pages > Source: Deploy
from a branch > `main` / `/ (root)` > Save**.
