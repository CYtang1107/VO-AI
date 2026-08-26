# VO-AI — Variation Order Intelligence

A decision-support web application for construction **Variation Order** management, built for
the 中国建筑国际集团 "海之子"杯 AI智能体挑战计划 (China State Construction "Hai Zhi Zi Cup" AI
Agent Challenge) by **Team GUD**.

**▶ Live application: https://cytang1107.github.io/VO-AI/**

No installation, no account, no password. Open the link and it works.

---

## The problem

When a client changes a floor finish from ceramic tile to marble, a quantity surveyor has to
determine whether the change is a variation at all, find the contract clause that governs it,
remeasure the affected work, check every claimed rate against the priced Bills of Quantities,
assemble the supporting evidence, and move it through approval — with the information spread
across emails, spreadsheets, drawings and messaging apps.

Miss one rate, and someone is paid the wrong amount.

## What VO-AI does

Three roles work on one shared variation register, each able to edit only the columns the
contract gives them:

| Role | Responsibility |
|---|---|
| **Contractor QS** | Raises the variation, records the instruction, enters the measurement, attaches drawings and supporting documents, submits |
| **Consultant QS** | Creates the project, uploads the contract and priced BQ, cross-checks every rate, assesses cost and time impact, approves or rejects |
| **Client / Developer** | Reviews the recommendation, certifies the value, requests further information, tracks the whole project |

---

## Core functions

### Contract-BQ rate cross-check

The heart of the system, and a control quantity surveyors perform by hand today. For every
measured item, VO-AI compares the rate the contractor claimed against the rate in the priced
contract Bills of Quantities and returns one of three verdicts:

| Verdict | Meaning |
|---|---|
| **Same rate** | Matches the contract BQ rate — valued at the contract rate |
| **Different rate** | Rates differ. Names which rate governs, whether the claim is overstated or understated, and by how much in ringgit and percent |
| **Star rate** | No comparable BQ item exists — must be agreed separately, supported by a quotation or build-up |

The system **finds the comparable BQ item itself**, matching on bill code, description
similarity and unit agreement, and explains how it matched. Where it cannot match confidently
it returns nothing rather than guessing — a wrong automatic match would compare a claim
against an unrelated contract rate while looking like it worked.

### Variation classification and contract clause analysis

Classifies a change as a specification change, addition, omission, quantity variation or design
revision, then matches it to its governing clause from the **PAM 2018** and **PWD 203A**
standard forms — returning the entitlement the clause creates and the evidence the contractor
must produce. Where a description is too vague to classify, it says so rather than offering a
clause it cannot support.

### Element-based consequential measurement

A change rarely stops at the element named in the instruction. Substituting a block wall for a
brick wall can also change the wall finishes, the damp-proof course, the skirting and the
painting. VO-AI holds a knowledge base of 20 building elements and their relationships, and
prompts the surveyor to confirm whether the related elements need remeasuring — the things an
experienced surveyor remembers to check.

### Contractual time bars

Three clocks, computed automatically and surfaced with approaching and overdue states:

- Consultant's evaluation — **30 days** from the variation being issued
- Consultant's request for further information — **28 days**
- Contractor's response to that request — **28 days** from the request

### Bills of Quantities import

Upload a priced BQ as **CSV or XLSX** — parsed natively, with no library. The system works out
which column holds the code, description, unit and rate by examining the data, explains its
reasoning, previews what it will import and reports which rows it skipped (headers, section
titles, subtotals). Nothing is imported until you confirm, and you can correct any column
first — these rates become the benchmark for every later comparison.

### Documents and evidence

Project documents (contract, priced BQ, addenda, specifications) and variation documents
(revised drawings, superseded drawings, supporting documents) with **revision history** — upload
a newer version and the previous one is retained. A project-wide Documents view shows the whole
evidence trail.

### Reports

Draft variation order reports in the section order a submission requires — instruction,
classification, contractual basis, revised drawing, superseded drawing, measurement and
valuation, supporting documents, findings, time impact, status and signatures. Each role gets a
report weighted to its needs, all rendered from the same record. Plus an all-variations summary
totalling claimed, assessed and certified values against the contract sum. Prints to PDF from
the browser.

### Assistant

A structured helper answering questions about the variation you are looking at — why a rate is
flagged, which clause applies, what is missing before certification, what you can edit and why.
Every answer is computed from that variation's real state. It is deliberately **not** a
free-text chatbot: when it cannot answer, it says so and offers what it can.

### Also

Role-based permissions with locked fields that explain why · dashboard showing what each role
owes · VO register with search and status filters · project export and import as a single file ·
optional device and project passcodes · **English / 中文 interface** · works on a phone.

---

## The design principle

**Every figure and every contractual reference VO-AI displays can be traced to data the user
entered or to a clause table that ships with the source code.**

The system shows no confidence score, because nothing in it produces a probability. It cites no
clause it cannot find. A variation that has not been certified shows no certified value. Where
the analysis is uncertain, it says so and asks for what it needs.

An earlier prototype displayed a hardcoded "94% confidence" and a fixed clause reference that
never changed whatever the user typed. Removing that, and making sure nothing like it could
return, is why this version exists.

VO-AI is decision support. Final assessment, certification and approval remain with the
responsible construction professional, and every screen that shows a generated result says so.

---

## Running locally

No build step and no dependencies. Serve the folder over HTTP:

```bash
python -m http.server 8080
```

Then open http://localhost:8080/.

## Signing in

No passwords — enter a user ID and pick a role. Suggested for the seeded demo project:

| Role | User ID |
|---|---|
| Contractor QS | `ong.weihan` |
| Consultant QS | `serena.wong` |
| Client / Developer | `tan.ziqian` |

**Restore demo data** on the Projects screen resets everything to the seeded scenario.

## Tests

```bash
node --test
```

## How it works

Zero dependencies — no framework, no build step, no npm packages, no CDN. All state lives in
your browser's `localStorage`; nothing is sent anywhere.

| Module | Responsibility |
|---|---|
| `js/calc.js` | Money, dates, VO totals |
| `js/permissions.js` | The role edit matrix |
| `js/clauses.js` | Contract clause knowledge base |
| `js/elements.js` | Building elements and their relationships |
| `js/analysis.js` | Classification, BQ matching, rate cross-check |
| `js/deadlines.js` | Contractual time bars |
| `js/bqimport.js` | CSV / XLSX parsing and column detection |
| `js/documents.js` | Document revision history |
| `js/assistant.js` | Grounded question answering |
| `js/store.js` | Data model, seed data, persistence |
| `js/i18n.js` | English / 中文 |
| `js/ui.js` | Shared chrome, guards, toasts |

The analysis engine is deterministic and rule-based. There is no language model in this build —
see `docs/proposal/2.2-technical-solution.md` for the reasoning and the Version 2 roadmap.

## Deploying

Published from `main` at **https://cytang1107.github.io/VO-AI/**. A static site with no build
step, so any push to `main` republishes within about a minute.

## Documentation

- `docs/proposal/` — technical solution, innovation, completion quality, demo walkthrough,
  video script, and a guide to revising the submitted proposal
- `docs/superpowers/specs/` — the product specification
- `docs/superpowers/plans/` — the implementation plan

## Team

**GUD** — Ong Wei Han · Tang Chee Yang · Serena Wong Yuet Tong · Tan Zi Qian

## Licence

Submitted for the "海之子"杯 AI智能体挑战计划, 2026.
