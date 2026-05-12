# STYLESHEET.md

The single source of truth for the visible product. Read this before any UI work.

If a screen disagrees with this file, the screen is wrong. Fix it back. Don't drift the system.

---

## Charles — design principles

1. **One idea per screen.** If a page has two focal elements it has zero. Pick the one thing the founder is here to do and let everything else recede.
2. **Subtraction over addition.** The default move is to remove. A pixel, a label, a setting, a toggle — each has to earn its place. A surface that does one thing well beats a surface that does five things badly.
3. **Confidence, not noise.** No glow, no gradients, no celebratory chrome. Charles is the steady hand in the room. The work is loud; the interface is quiet.
4. **Memory, not novelty.** The product gets better the longer you use it. Reward continuity. Don't reset state for the sake of a fresh paint job.
5. **Approval is a feature, not friction.** Human-in-the-loop is the contract. The approval banner is the most important component in the system. Treat it that way.

---

## Voice & copy

- **Founder-first, second-person.** Speak to one solo founder. "You ship." "You approve." Never "users", never "customers", never "we help businesses".
- **Verbs over nouns.** "Ship a draft." "Approve the spend." "Hire an engineer." Action words carry the weight; nouns recede.
- **One idea per sentence.** If a sentence has a comma and an "and", split it.
- **Lowercase for chrome, sentence case for content.** Buttons and labels are sentence case. No title case anywhere.
- **Periods on toasts and microcopy.** Confidence punctuates. No exclamation marks. No emoji. Ever.
- **Ban list (never use):** revolutionary, unleash, supercharge, 10x, magic, AI-powered, game-changing, paradigm, seamless, robust, leverage, empower, world-class, next-gen, cutting-edge.
- **Preferred vocabulary (the Charles dictionary):** ship, build, decide, approve, run, hire, fire, draft, send, hold, route, remember, own.
- **Charles refers to himself in the first person.** "I drafted the email. Approve to send." Not "Charles drafted" — that's third-person marketing speak inside the product.

---

## Typography

One typeface for the entire product. No display fonts. No decorative weights. Charles is a tool, not a magazine.

- **Family:** Inter, with the system stack as fallback — `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Weights in use:** 400 (body), 500 (UI labels, buttons), 600 (wordmark, headings). No 700, no 800, no italics in chrome.
- **Sizes (px):** 12, 14, 16, 20, 28, 40. No other sizes exist. If you reach for 18 or 32, you're wrong.
  - 12 — muted labels, captions, footnotes.
  - 14 — UI default (buttons, inputs, table cells).
  - 16 — body copy, chat messages.
  - 20 — section headings.
  - 28 — page titles.
  - 40 — hero only. One per page.
- **Line-height:** 1.5 for body (16/24), 1.4 for UI (14/20), 1.1 for hero (40/44), 1.2 for headings (28/34 and 20/24).
- **Tracking:** `-0.01em` on 28 and 40. `0` everywhere else. No expanded tracking. No uppercase tracking gimmicks.

---

## Color

A small palette. Each color has a role, not a vibe.

- **Accent — `#0A0A0F`** (deep blue-black). The Charles signature. Used for primary buttons, the approval banner background, the wordmark on light surfaces, and one-of-one focal moments. Earned, never decorative.
- **Positive — `#1F6E3A`** (forest green). Successful approvals, "shipped", "sent", positive deltas. Never for buttons that aren't confirmations.
- **Warning — `#B7791F`** (amber). Approval pending, awaiting decision, attention-needed. Never red-shifted into alarm.
- **Destructive — `#8B1A1A`** (deep red). Decline, fire, delete, irreversible spend. Buttons only — never as background, never as text color in body copy.
- **Neutrals (9 steps, light → dark):** `#fafafa`, `#f4f4f5`, `#e4e4e7`, `#d4d4d8`, `#a1a1aa`, `#71717a`, `#52525b`, `#27272a`, `#0a0a0a`. Surfaces, borders, body text, muted text — everything that isn't meaning-bearing lives here.
- **No gradients.** Anywhere. If a designer reaches for one, the answer is no.
- **No shadows.** Hairline borders (1px, neutral-300 on light, neutral-700 on dark) carry structure.

---

## Spacing & layout

- **4-pt grid.** Every margin, padding, and gap is a multiple of 4.
- **Named scale:**
  - `xs` — 4
  - `sm` — 8
  - `md` — 16
  - `lg` — 24
  - `xl` — 40
  - `2xl` — 64 (section breaks on marketing only)
- **Max content width:** 960px on marketing pages. The hero, the body, the footer — all live inside 960.
- **Max chat width:** 720px. Chat is reading, not browsing. Long lines are hostile to comprehension.
- **Gutters:** 24 minimum on mobile, 40 on desktop. No edge-to-edge content except the navbar and the approval banner.

---

## Motion

A short, strict policy. Motion is punctuation, not decoration.

- **Easing curve:** `cubic-bezier(0.2, 0.8, 0.2, 1)` — fast out, soft in. One curve. No bounce. No spring overshoot.
- **Durations:**
  - 120ms — hover, focus, micro (button press, checkbox).
  - 240ms — panels, modals, drawers, sheets.
  - 400ms ceiling — nothing animates longer than this. If a transition wants 500ms, it's a redesign, not a duration tweak.
- **Banned:** bounce, glow, pulse-loops, parallax, scroll-jacking, marquee, confetti.
- **Reduced motion:** `prefers-reduced-motion` collapses every animation to a 1-frame opacity step. No exceptions.

---

## Components

These are the only components. Anything not on this list does not exist without an explicit addition to this file.

- **Button (primary):** filled accent, white text, 14/20, weight 500, 8px radius, 120ms press. One per screen.
- **Button (secondary):** neutral-100 fill, neutral-900 text, hairline border. Used when there are exactly two equal-weight actions.
- **Button (ghost):** no fill, no border, neutral-700 text. For tertiary actions and inline controls.
- **Button (destructive):** filled destructive red, white text. Only for delete/decline/fire actions. Never primary.
- **Input:** single-line, hairline border, 14/20, 8px radius, neutral-50 background on light. Focused state: accent border, no glow.
- **Card:** neutral-50 background, hairline border, 12px radius, 24px padding. No shadow. Used to group, not to decorate.
- **Modal:** centered, max 480px wide, 16px radius, neutral-50 background, hairline border, 240ms fade-and-rise (8px). Backdrop is neutral-900 at 40% opacity. One modal at a time.
- **Dropdown:** anchored to trigger, hairline border, 8px radius, 4px item padding, 14/20 text. No icons unless they carry meaning.
- **Tooltip:** 12/16, neutral-900 background, white text, 6px radius, 6px padding. Only for keyboard shortcuts and icon-only buttons. Never for explaining a feature — if it needs a tooltip to explain, the design is wrong.
- **Chat block:** 720px max, 16/24 body, message gap 16, sender label 12/16 muted. No bubbles, no avatars — Charles is the only other speaker and the column itself is the conversation.
- **Approval banner:** see below.

---

## Approval banner

The defining Charles UI element. Treat it as the most important pixel surface in the product.

- **Color:** filled accent (`#0A0A0F`) background, white text. It is the only persistent accent surface on the screen.
- **Persistence:** stays until acted on. Does not auto-dismiss. Does not collapse on scroll. Does not animate in/out for taste — it just is.
- **Anatomy (top to bottom, in this order):**
  1. **Risk level** — one word: `low`, `medium`, or `high`, 12/16, weight 500, neutral-300 color, lowercase.
  2. **Summary** — one sentence, 16/24, weight 500, white. "I drafted the launch email to 2,400 subscribers."
  3. **Two buttons** — primary "Approve" (filled white, accent text) and secondary "Decline" (ghost, white border, white text). No "more options". No "remind me later". Decide.
- **Position:** docked top, full width, 56px height minimum, 16px horizontal padding.
- **One at a time.** Multiple pending approvals queue; they do not stack.

---

## Branding

- **Wordmark only.** No logo mark in v1. The word "Charles" set in Inter weight 600 is the brand.
- **Wordmark color:** accent on light surfaces, white on dark surfaces. Never colored, never gradient, never outlined.
- **Wordmark size:** 20/24 in the navbar, 28/34 in the footer wordmark, 40/44 in the hero only.
- **Favicon:** the letter `C` in Inter weight 600, white on accent (`#0A0A0F`), 1px corner radius at favicon scale.
- **No tagline next to the wordmark.** The product earns the explanation, the wordmark doesn't carry it.

---

## What this file is NOT

- Not a component library. The code lives in `components/`. This file describes what the code is allowed to look like.
- Not Figma. There is no companion design file. This document is the spec.
- Not an exhaustive token list. If a token isn't here, it doesn't exist. Don't invent one — propose an addition to this file first.
- Not negotiable per-screen. A screen that disagrees with this file is wrong. Fix the screen.
