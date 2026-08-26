# 4. Team Responsibilities

> **⚠ Before submitting: two sections below are marked [NEEDS INPUT].** They describe the
> development phase, and I have only observed part of it. Fill those in from what each member
> actually did — do not submit them as they stand. Everything else is verifiable from the
> repository's commit history.

The VO-AI project ran in two phases. The first established the concept, the target users and
the proposed system design, and produced the project proposal. The second built the system
itself: a working web application, now deployed and publicly accessible, developed by
directing AI coding agents and verifying their output.

The division of responsibilities below covers both phases.

---

## 4.1 Ong Wei Han — Project Planning and System Concept

**Proposal phase.** Responsible for the overall project planning and development concept. His
main contributions included identifying the objectives of VO-AI, defining the target users and
user pain points, and establishing the overall application scenarios. He also contributed to
the development of the system's value proposition and ensured that the proposed solution
addressed practical problems in the variation order process.

**Development phase.** [NEEDS INPUT — what did Ong Wei Han do on the built system? Testing,
domain review, requirements, demonstration preparation, video, screenshots?]

---

## 4.2 Tan Zi Qian — Technical Solution and System Workflow

**Proposal phase.** Responsible for the technical solution and system workflow. His
contributions included developing the overall process of VO-AI — user input, document
analysis, variation detection, knowledge-base retrieval, contract analysis, cost assessment,
report generation and human verification — together with the knowledge-base structure,
workflow and tool calls, and the proposed system architecture.

**Development phase.** [NEEDS INPUT — what did Tan Zi Qian do on the built system?]

---

## 4.3 Tang Chee Yang — Functional Design, Development Direction and Domain Input

**Proposal phase.** Responsible for the functional design and innovation aspects of VO-AI. Her
contributions included defining the core system functions — secure document management, AI
variation detection, contract clause analysis, cost impact estimation, automated VO report
generation and VO tracking — and the functional architecture, together with the identification
of the system's technological, application, interaction, content organisation and user
experience innovations.

**Development phase.** Directed the construction of the working application. Her contributions
included:

- **Specifying the functional requirements** that shaped the built system, including the
  three-role permission model, the per-role document columns and the workflow gating.
- **Supplying the quantity-surveying domain knowledge that no software tool could provide** —
  the contractual time bars (the consultant's 30-day evaluation period, the 28-day period for
  requesting further information, and the contractor's 28-day period to respond), and the
  principle that a change to one building element requires the elements commonly affected with
  it to be remeasured.
- **Testing the application as a user and identifying gaps that automated review had missed.**
  Two examples: project-level documents were being stored but never displayed anywhere, and
  once a project had been created there was no way to add a contract addendum at all. Neither
  defect was visible in the code — both were found by using the system.
- **Setting the direction on interface and access design**, including project selection
  preceding the working navigation, and moving the optional passcode from the application to
  the project so that a consultant controls access to their own project.
- Preparing the demonstration materials and the submission documentation.

---

## 4.4 Serena Wong Yuet Tong — Initial Prototype, Documentation and Integration

**Proposal phase.** Responsible for project documentation, content integration and
demonstration preparation. Her contributions included consolidating the work produced by the
team members, ensuring consistency between the sections of the project, preparing the project
documentation, and reviewing the overall system description so that the proposed functions,
technical solution and user scenarios were presented clearly.

**Development phase.** Produced the **initial working prototype** of the VO-AI interface,
developed with AI assistance, which established the visual structure and the dashboard concept
that the delivered system was built from. She also owns and maintains the team's project
repository.

[NEEDS INPUT — anything further Serena did on the built system, or on the video, screenshots or
final documentation.]

---

## 4.5 Team Collaboration and Working Method

Specific responsibilities were assigned to each member, but the project was developed through
continuous collaboration, with members discussing the concept, reviewing each other's work and
providing feedback throughout.

The development phase used a particular working method that is worth describing, because it
shaped the result.

The application was built by **directing AI coding agents and verifying their output** rather
than by accepting it. Each unit of work was specified, implemented, then independently
reviewed before being accepted, with the review recorded. The repository's commit history
documents this: the system reached 310 automated tests through iterations in which
AI-generated work was frequently corrected or rejected.

Three examples show why the verification mattered more than the generation:

1. **A fabricated confidence score was removed.** The initial prototype displayed "94%
   confidence" and a fixed contract clause reference, neither of which changed regardless of
   what the user entered. Both were hardcoded text. Recognising that this was a claim the
   system could not support — and deciding to remove it rather than keep an impressive-looking
   figure — set the design principle the whole product now follows.

2. **A defect that prevented the application from rendering survived six automated reviews.**
   Every review confirmed that the tests passed and that every file was served successfully.
   None had opened a browser console. A served file is not a parsed file. After this was
   found, every subsequent change was verified visually in a live browser before acceptance.

3. **An automatic rate-matching method was rejected before it shipped.** During testing it was
   found to score a genuine star-rate item as a closer match to an unrelated contract item than
   a correct match scored — it would have produced a confident wrong answer of exactly the kind
   the product exists to prevent. It was replaced with a measure that separates those cases
   with a clear margin, and the reasoning was documented rather than hidden.

The team's contribution was therefore **direction and verification**: deciding what to build,
supplying the construction and quantity-surveying knowledge the tools did not have, and
recognising when the output was wrong. The final system covers the complete variation order
lifecycle, from submission and analysis through professional review to approval and tracking.
