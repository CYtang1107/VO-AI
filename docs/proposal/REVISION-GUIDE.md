# Proposal Revision Guide

**What to change in `Proposal.docx` before submitting, and why.**

The proposal was written before the system was built. It describes an architecture the team
planned; the system that now exists works differently — and in most respects better, because
it is real. This guide lists every place the document and the software disagree.

**The single most important change is §2.2.** Everything else on this list is tidying.

---

## ⚠️ CRITICAL — §2.2 Technical Solution

### The problem

The submitted §2.2 states that VO-AI:

- "can be implemented using an AI agent development platform such as **Dify or Coze**"
- uses a **large language model** via an "AI/API Layer"
- stores documents in a **Vector Knowledge Base** as "searchable embeddings"
- runs on a **backend application server** with a **database**
- is "deployed through a secure **cloud environment**"

**None of these exist in the delivered system.** VO-AI is a static web application with no
server, no database, no language model and no vector store. Its analysis is a deterministic
rule engine.

### Why this must be fixed

A judge who reads §2.2 and then opens the live link finds an architecture that does not match
the description. That does not read as ambition — it reads as overclaiming, and it puts every
other statement in the document in doubt.

There is a sharper irony. The product's central design principle is that it never displays a
number or a contractual reference it cannot justify. A technical section describing components
that do not exist contradicts the very thing that makes the product credible.

### The fix

Replace §2.2 entirely with `docs/proposal/2.2-technical-solution.md`.

That version describes what actually runs and argues for it on its merits:

- **Independently developed**, not on Dify or Coze — stated plainly, with three reasons: the
  calculations must be auditable, the app must be usable instantly, and project data never
  leaving the browser is a real privacy guarantee rather than a policy promise.
- The **seven-stage processing pipeline**, each stage a named, tested function.
- The **contract-BQ rate cross-check** explained with the worked marble example.
- The **role and permission model** as an implementation of the contractual relationships.
- The **clause knowledge base** — what it holds and how it is structured.
- **§2.2.7 states the current limits plainly** and places the LLM, the server and document
  parsing in a Version 2 roadmap.

That last part is the key move. The LLM is not dropped from the proposal — it is repositioned
from "what we built" to "what comes next, and here is why we sequenced it that way." A panel
of engineers will recognise that as judgement. Claiming a vector database that isn't there
will not survive one question.

---

## ⚠️ Cover page — the project link

The cover currently gives the project link as:

> https://chatgpt.com/

Replace with:

> **Live application:** https://cytang1107.github.io/VO-AI/
> **Source code:** https://github.com/CYtang1107/VO-AI

This is submission item 1 ("Agent link or code package"). Leaving a link to ChatGPT on the
cover of a document about your own system is the kind of detail a judge remembers.

---

## §2.5 Overall Completion Quality

**Current text says:** "VO-AI has achieved a strong level of completion at the **conceptual and
prototype development stage**", that it "does not yet demonstrate full-scale deployment", and
describes the architecture as a "foundation for future implementation".

That was true when written. It is now a serious undersell — the system is deployed, tested and
publicly usable.

**Replace with** `docs/proposal/2.5-overall-completion-quality.md`, which leads with the
measurable state (303+ automated tests, 20 modules, 9 screens, zero dependencies, live URL),
lists what is complete, and then states the limitations honestly — no document-content
parsing, no PDF extraction, no drawing comparison, no authentication, local-only data.

Keep the honest limitations. They are more persuasive than the original's vagueness, and they
are consistent with the product's own principle.

---

## §2.4 Innovation and Differentiation

**Current text** is generic: "combining artificial intelligence, document management, contract
analysis, cost estimation and workflow tracking within one centralised system." Every entrant
will write something close to that.

**Replace with** `docs/proposal/2.4-innovation-and-differentiation.md`, which argues four
things a competitor cannot copy from a description:

1. **An agent that refuses to fabricate** — no confidence score, no invented clause, no
   certified value on an uncertified variation, and a matcher that returns nothing rather than
   a weak guess.
2. **Automatic contract-BQ rate cross-checking** — a real professional control, automated,
   with the reason for each match shown.
3. **Element-based consequential measurement** — the block wall / DPC / skirting relationship.
   This is domain knowledge, not software convention, and a construction panel will recognise
   it immediately.
4. **The contract expressed as software** — columns owned by roles, editing rights following
   the workflow, and locked fields that explain themselves.

---

## §3 Demo Examples

**Currently placeholder text** — the instructions were never replaced with content.

**Replace with** `docs/proposal/3-demo-examples.md`, which provides:

- **§3.1** — the live link, the no-login access method, three suggested user IDs and roles, a
  four-step getting-started sequence, and three test questions a judge can answer in the live
  system.
- **§3.2** — an eight-step case demonstration following the ceramic-to-marble variation through
  all three roles.

**You must add eight screenshots.** The slots are marked in the file and each is described, so
the text stands on its own. Capture at 1440px width from the live site using the seeded demo
data:

1. Sign-in screen with the three role cards
2. Create-project panel with the BQ import
3. VO detail — contractor's panel with measurement and documents
4. **The measurement table showing all three rate verdicts** — the most important image
5. Assessment panel with governing clause and findings
6. Client's view with certification fields editable
7. The printed report
8. Dashboard with deadlines, plus the all-variations summary

---

## §4 Team Responsibilities

The existing section describes contributions to the **proposal document**: planning, technical
solution, functional design, documentation. That was accurate for the proposal but does not
describe building the system.

Update it to cover what each member did on the delivered software as well — and note that
Tang Chee Yang is referred to as "her" in the current text; check that pronoun with the person
concerned before submitting.

---

## Cover page — other details

- **Team name:** the cover says "GUD". An earlier version said "GUD GUD". Pick one.
- **Submission date:** the cover says 30 August 2026; the portal deadline is 31 August. Set it
  to the date you actually submit.

---

## Still to produce — not a revision, new work

**Human-AI collaboration resume** (submission item 4): "a brief overview of team members' AI
application capabilities."

Nothing exists for this yet. The team has an unusually strong case, because the evidence is in
the repository rather than merely asserted:

- 44+ commits of AI-assisted development, each reviewed before acceptance
- Documented cases of **catching AI output being wrong** — the fabricated "94% confidence" that
  was deleted; a rendering defect that passed six automated reviews because none opened a
  browser console; a rate-matching method rejected for matching a genuine star rate to an
  unrelated contract rate
- Domain knowledge no model supplied: the element-consequence relationships, the PAM clause
  references, the 30/28/28-day contractual periods

The strongest framing is that the team's contribution was **direction and verification** —
knowing what to build, knowing when the output was wrong, and knowing the domain well enough
to tell the difference.

This needs real input from each member: what they did, what AI tools they use and for what,
and a specific instance where they rejected or corrected AI output.

---

## Checklist

| Item | Action | Status |
|---|---|---|
| §2.2 Technical Solution | Replace entirely | ⚠️ Critical |
| Cover project link | Change from chatgpt.com to the live URL | ⚠️ Critical |
| §2.5 Completion Quality | Replace | Recommended |
| §2.4 Innovation | Replace | Recommended |
| §3.1 Access Method | Replace | Required — currently placeholder |
| §3.2 Case Demonstration | Replace + add 8 screenshots | Required — currently placeholder |
| §4 Team Responsibilities | Update for the built system; check one pronoun | Recommended |
| Team name | Resolve GUD / GUD GUD | Minor |
| Submission date | Match the actual date | Minor |
| Human-AI collaboration resume | Write from scratch | ⚠️ Missing deliverable |
| 2-minute video | Record | ⚠️ Missing deliverable |

Drafts for every "Replace with" row are in `docs/proposal/`.
