# Competitor Watch

Most "competitive analysis" is the internet describing the wrong thing. This plugin pulls what *you* already know — from your own notes, conversations, and network — before reaching for any external source.

## What it does

- `/scout {competitor}` — Charles pulls every prior mention of the named competitor from your history, finds people in your network connected to them, and writes a one-page brief.

## Skill bundles

- `competitor_news` — flat list of every prior mention of a competitor, grouped by theme (product, pricing, hiring, fundraising, customer wins), sorted by recency.
- `pricing_diff` — chronological view of a competitor's pricing as recorded in your notes. Reports drift, not speculation.

## Who it's for

Founders who keep notes — meetings, calls, decks — but don't have a system to mine them later. The plugin is read-only: it never invents data.

## Assumptions

- `recall_history` returns prior notes with timestamps and source attribution.
- `find_person` can match a free-text competitor name against a person's employment history or known company.
- Competitor names are passed verbatim — no fuzzy match. If you call it `OpenAI` and your notes call it `Open AI`, you get fewer hits.

## Install

Copy this folder into the repo's `plugins/` directory. Restart the server.

## Limits

- Read-only. No writes to people, deals, or notes.
- Quality is bounded by the quality of your own notes. Garbage in, garbage out.
