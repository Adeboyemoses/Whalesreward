---
name: implementation-brief
description: "Use before building any Whales Rewards screen covered by a hi-fi board, to turn a canvas flow row plus its decision note into docs/briefs/<surface>-row-<nn>-<slug>.md. Not for back-end-only work."
---

# Implementation brief

Input: a flow row from `product-docs/04 UI Design/Hi-Fi/README.md` (e.g. "Attendant · Row 2 · Record a sale (online)").

1. List the row's boards in order. For each, open `<ID>.png` (look at it) and `<ID>.html` (structure, `wr-` classes, exact copy).
2. Find the matching decision note in `product-docs/04 UI Design/{Attendant Mobile,Admin Portal}/` and read its "Hi-fi flow — 4 November 2026" section and the rules above it. Grep the F&R for the feature (F01–F12).
3. Write `docs/briefs/<surface>-row-<nn>-<slug>.md`:

```
# <Surface> row <nn>: <title>
Boards: <IDs in order>   Feature: F<nn>   Invariants: I-<nn>, …
Decision note: <path>

| Board | Route | Components (src/ui) | Reads (contract) | Writes (contract) | States | Permission |
|---|---|---|---|---|---|---|

## Behaviour
- <rule> (source: <note or F&R section>)

## Copy
- Exact strings that matter (status words, confirmations, errors). Deviations from the board, with reasons.

## Contracts needed
- <zod contract name>: fields, types (kobo strings, decimal strings, ISO times) — lane:core child issue if missing

## Open questions
- <question> — default: <default>
```

4. Every state on the board row must appear in the States column, including offline, held and error states.
5. Flag any conflict between board, note and F&R; the newer decision note wins, then F&R, then the board.
6. Commit the brief on the work order's branch; the EM links it from the work order.
