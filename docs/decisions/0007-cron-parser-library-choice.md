# 0007. Cron library: `cron-parser`, not a hand-rolled parser

Status: Accepted
Date: 2026-07-13

## Context
`schedules.cron_expr` needs to turn into a concrete next-run timestamp. This project's "no
ORM, hand-written SQL, minimal dependencies" ethos might argue for hand-rolling a cron parser
(the author has in fact built one before, as a standalone portfolio piece), but that piece
exists to *demonstrate* cron parsing as the point of the project. Here, cron parsing is a
utility the scheduler needs correctly and boringly — standard fields, standard ranges/steps/
lists, well-tested edge cases (month-end, DST) — not something this project is trying to prove
anything about.

## Decision
Use `cron-parser` (`parseExpression(cronExpr, { currentDate, utc: true }).next().toDate()`,
wrapped in `computeNextRunAt()`). Always pass `utc: true` so schedule math is timezone-
independent, matching `timestamptz` columns and avoiding host-timezone-dependent behavior.

## Consequences
- Standard cron syntax (`*/5 * * * *`, ranges, lists, step values) works correctly without
  reimplementing and re-testing cron-field parsing edge cases here.
- `computeNextRunAt` is one thin wrapper function, easy to swap later if ever needed.
- Rejected: hand-rolling a parser — this project's "no dependencies" ethos is about not
  reaching for an ORM/query-builder to do what raw SQL already does well, not about avoiding
  every well-scoped utility library. A cron parser is exactly the kind of narrow, well-tested
  dependency that's cheaper to depend on than to reimplement and re-verify.
