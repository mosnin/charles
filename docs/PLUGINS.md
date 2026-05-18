# Plugins

Plugins extend Charles with two things, and only two things:

- **Slash commands** — named prompt templates a founder can invoke with `/name`.
- **Skill bundles** — sub-agent definitions (instructions + tool allowlist) that the runtime can spin up on demand.

Everything in a plugin is **declarative data**. No executable code crosses the boundary. A plugin does **not** make network calls, write to the DB directly, touch the filesystem, or import a single module of Charles internals. It describes what the agent should do; the runtime owns execution.

That constraint is the point. A founder can drop a stranger's plugin into the repo without auditing JavaScript, because there is no JavaScript to audit — only JSON.

---

## Where plugins live

`plugins/<plugin-id>/` at the repo root. Each plugin is a directory containing:

- `plugin.json` — the manifest (required)
- `README.md` — for human readers (optional but encouraged)

The loader walks `plugins/` at server startup, parses every `plugin.json`, validates against the schema, and registers the successful ones. There is no hot-reload. There is no per-workspace upload yet (Phase 7).

---

## The manifest

```jsonc
{
  "id": "daily-standup",          // lowercase, digits, "-" only. Globally unique.
  "name": "Daily Standup",        // ≤ 60 chars. Human-readable.
  "version": "0.1.0",             // semver MAJOR.MINOR.PATCH.
  "author": "Your Name",          // any non-empty string.
  "description": "…",             // ≤ 280 chars. One sentence ideal.
  "homepage": "https://…",        // optional URL.
  "slashCommands": [ … ],         // 0..50 entries.
  "skills": [ … ]                 // 0..10 entries.
}
```

Stored as JSON on disk. YAML is not supported — Zod parses JSON natively, and adding a YAML dependency for a configuration file most authors will generate from a template is not worth the surface area. If you want to author in YAML locally, convert before committing.

---

## Slash commands

```jsonc
{
  "name": "scout",                // /scout — lowercase + digits + "-".
  "description": "Research a competitor.", // ≤ 140 chars.
  "prompt": "Scout the competitor named \"{{competitor}}\". …",
  "args": [
    {
      "name": "competitor",       // snake_case.
      "description": "The competitor name to scout.",
      "required": true
    }
  ]
}
```

### Invocation

A founder types `/scout Acme` in the chat. The loader tokenises the invocation: first token is the command, remaining tokens are positional and bound to the declared `args` array in order. Double-quoted segments allow spaces: `/scout "Acme Corp"`.

### Template interpolation

The prompt supports `{{arg_name}}` substitution. Names must be lowercase snake_case. Unfilled args become an empty string — there is no error, no warning. Design your prompts to tolerate missing input gracefully.

```text
"Scout the competitor named \"{{competitor}}\". …"
```

### Name collisions

Slash command names are **global across all plugins**. If two plugins both define `/scout`, the first one loaded wins and the loader logs a warning. Rename one of them.

---

## Skill bundles

A skill bundle declares a sub-agent the runtime can delegate to. It is the data side of `lib/ai-tools/sdk-skills.ts`.

```jsonc
{
  "name": "competitor_news",      // snake_case. Used as the skill identifier.
  "description": "Pulls every prior mention…", // ≤ 140 chars.
  "instructions": "You surface what we already know about a given competitor. …",
  "tools": ["recall_history"],    // names from ALL_TOOLS in lib/ai-tools/tools.
  "model": "gpt-5-mini"           // optional. Defaults to the SDK default.
}
```

### Tool allowlist

The `tools` array lists tool names from `lib/ai-tools/tools/index.ts` (`ALL_TOOLS`). The loader validates these at startup against the catalog and reports any unknown names — the skill still loads, but the runtime will refuse to bind the missing tool.

Current catalog (lowercase snake_case): `find_person`, `add_person`, `set_followup`, `clear_followup`, `mark_person_hot`, `mark_person_cold`, `archive_person`, `note_on_person`, `create_deal`, `note_on_deal`, `add_checklist_item`, `find_property`, `draft_email`, `draft_sms`, `send_email`, `send_sms`, `recall_history`, `read_attachment`, `create_plan`.

Inventing tool names is not allowed. If you need a tool that doesn't exist, omit it and file an issue.

---

## How to write your first plugin

1. **Create a folder.** `mkdir plugins/my-plugin/`
2. **Write a manifest.** Copy from `plugins/daily-standup/plugin.json` and edit. Start with one slash command and zero skills.
3. **Pick tool names from the catalog.** Match exactly. Snake_case.
4. **Restart the server.** The loader runs at boot. Watch the log for `[plugins]` lines.
5. **Invoke it.** Type `/my-command` in chat.

That's it.

---

## Sample plugins

Three samples ship in `plugins/` as reference and starting templates:

- **`daily-standup`** — Three-question standup ritual with a synthesis skill.
- **`competitor-watch`** — Scout a named competitor using prior history and known contacts.
- **`fundraise-prep`** — Deck outline, data room audit, and per-investor briefs.

Each has a README. Read them.

---

## Limits

- Plugin IDs must be unique. Duplicates are rejected and logged.
- Slash command names are global. Collisions log a warning; first match wins.
- Max **50** slash commands per plugin.
- Max **10** skill bundles per plugin.
- Plugin descriptions max 280 chars; slash and skill descriptions max 140.

---

## What plugins *cannot* do

- Make HTTP requests.
- Write to the database directly.
- Read or write the filesystem.
- Import any Charles internal module.
- Reach across to other plugins.

If you need any of the above, the work belongs in `lib/ai-tools/tools/` as a first-class tool — not in a plugin.
