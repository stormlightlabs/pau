# Review and verification

A design critique and a technical audit answer different questions. Run both for
a broad review, then synthesize by user impact.

## Design critique

Inspect the rendered surface before mechanical findings can anchor the review.
Assess:

- product specificity and fit;
- primary task and reading order;
- information architecture and discoverability;
- hierarchy, grouping, density, typography, color, and motion;
- cognitive load and visible decision count;
- emotional fit at waiting, failure, destructive, and success moments;
- consistency with neighboring screens and the owning design documents.

Use the squint test. Walk the primary task as a first-time user, a keyboard power
user, and a user who encounters long content or failure. Report two or three
strengths and no more than five priority problems.

## Technical audit

Inspect source and rendered behavior for:

- semantic HTML, names, focus, keyboard access, contrast, zoom, and reduced
  motion;
- responsive recomposition, touch targets, overflow, clipping, and overlays;
- token use, theme coverage, and semantic state consistency;
- font and image delivery, layout shift, expensive effects, and unnecessary
  dependencies;
- loading, empty, error, success, disabled, permission, reconnect, and
  long-content states;
- console errors and broken controls.

Automated accessibility and lint tools provide evidence, not a design verdict.
Verify findings in context and identify false positives.

## Prioritize

- **P0:** task cannot be completed, data is lost, or a critical path is
  inaccessible.
- **P1:** users face substantial confusion, risk, or a WCAG AA failure.
- **P2:** a workaround exists, but the defect degrades a common path.
- **P3:** polish with little effect on task completion.

Fix shared causes before local symptoms. Do not list dozens of P3 findings while
a primary path remains unclear.

For each issue, name the location, observable evidence, user impact, and smallest
correct fix. Keep personal taste out of severity.

## Bounded visual verification

1. Build or run the actual surface.
2. Inspect representative desktop and narrow sizes together.
3. Exercise the primary interaction with keyboard and pointer.
4. Check the important alternate state: loading, empty, error, waiting,
   destructive, or long content.
5. Fix the findings in one batch.
6. Confirm once and stop.

Do not claim visual verification from source inspection alone. Do not claim touch
or screen-reader verification unless those paths were exercised.

## Handoff

Update the owning design document when the visual system, surface contract, or
responsive behavior changed. State what was verified and what remains untested.
Do not add a ceremonial score when concrete findings communicate the result more
clearly.
