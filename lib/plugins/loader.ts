/**
 * Plugin loader — discover, validate, and resolve plugins from disk.
 *
 * Reads `plugins/<id>/plugin.json` once at startup. No watcher, no hot-reload.
 * Errors are collected, not thrown, so one malformed plugin doesn't take
 * down the whole catalog. Resolution of slash invocations and skill bundles
 * is a pure function over the loaded set.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  parsePluginManifest,
  PluginValidationError,
  type PluginManifest,
  type SkillBundleDef,
  type SlashCommandDef,
} from './manifest';

export interface LoadedPlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin's directory on disk. */
  pluginDir: string;
}

export interface LoadOpts {
  /** Defaults to `<process.cwd()>/plugins`. */
  pluginsDir?: string;
  signal?: AbortSignal;
}

export interface LoadError {
  pluginDir: string;
  reason: string;
}

export interface LoadResult {
  plugins: LoadedPlugin[];
  errors: LoadError[];
}

function defaultPluginsDir(): string {
  return path.join(process.cwd(), 'plugins');
}

function aborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

/**
 * Walk `pluginsDir`, parse each `plugin.json`, return successes + failures.
 * Never throws; missing directory yields an empty result.
 */
export async function loadPlugins(opts: LoadOpts = {}): Promise<LoadResult> {
  const pluginsDir = opts.pluginsDir ?? defaultPluginsDir();
  const plugins: LoadedPlugin[] = [];
  const errors: LoadError[] = [];

  let entries: string[];
  try {
    entries = await readdir(pluginsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { plugins, errors };
    }
    return {
      plugins,
      errors: [{ pluginDir: pluginsDir, reason: `cannot read plugins dir: ${(err as Error).message}` }],
    };
  }

  const seenIds = new Set<string>();
  const seenCommands = new Map<string, string>(); // command name -> plugin id

  for (const entry of entries.sort()) {
    if (aborted(opts.signal)) break;
    if (entry.startsWith('.')) continue;

    const pluginDir = path.join(pluginsDir, entry);
    let isDir = false;
    try {
      isDir = (await stat(pluginDir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const manifestPath = path.join(pluginDir, 'plugin.json');
    let raw: string;
    try {
      raw = await readFile(manifestPath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue; // a stray directory, not a plugin
      errors.push({ pluginDir, reason: `cannot read plugin.json: ${(err as Error).message}` });
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      errors.push({ pluginDir, reason: `invalid JSON: ${(err as Error).message}` });
      continue;
    }

    let manifest: PluginManifest;
    try {
      manifest = parsePluginManifest(parsedJson);
    } catch (err) {
      const msg = err instanceof PluginValidationError ? err.message : (err as Error).message;
      errors.push({ pluginDir, reason: msg });
      continue;
    }

    if (seenIds.has(manifest.id)) {
      errors.push({
        pluginDir,
        reason: `duplicate plugin id "${manifest.id}" — ids must be unique`,
      });
      continue;
    }
    seenIds.add(manifest.id);

    // Collision warning for slash command names. First match wins; we log
    // (via console.warn) so the founder sees the shadow.
    for (const cmd of manifest.slashCommands) {
      const prior = seenCommands.get(cmd.name);
      if (prior) {
        console.warn(
          `[plugins] slash command "/${cmd.name}" defined by both "${prior}" and "${manifest.id}"; first wins`,
        );
      } else {
        seenCommands.set(cmd.name, manifest.id);
      }
    }

    plugins.push({ manifest, pluginDir });
  }

  return { plugins, errors };
}

export interface ResolvedSlashCommand {
  plugin: LoadedPlugin;
  command: SlashCommandDef;
  args: Record<string, string>;
}

/**
 * Tokenise an invocation respecting double-quoted segments. Quotes around
 * a token let the caller include spaces; backslash escapes the quote.
 */
function tokenize(input: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      buf += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      i += 1;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (buf.length > 0) {
        out.push(buf);
        buf = '';
      }
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/**
 * Resolve a `/command arg1 arg2` invocation against the loaded plugins.
 * Positional args are bound to the declared `args` array in order. Extra
 * positionals are dropped; missing positionals stay unset (the renderer
 * will substitute an empty string).
 */
export function resolveSlashCommand(
  plugins: LoadedPlugin[],
  invocation: string,
): ResolvedSlashCommand | null {
  const trimmed = invocation.trim();
  if (!trimmed.startsWith('/')) return null;

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  const head = tokens[0];
  if (!head.startsWith('/') || head.length < 2) return null;
  const cmdName = head.slice(1);
  const positional = tokens.slice(1);

  for (const plugin of plugins) {
    for (const command of plugin.manifest.slashCommands) {
      if (command.name === cmdName) {
        const args: Record<string, string> = {};
        for (let i = 0; i < command.args.length; i += 1) {
          const argDef = command.args[i];
          if (i < positional.length) {
            args[argDef.name] = positional[i];
          }
        }
        return { plugin, command, args };
      }
    }
  }
  return null;
}

const TEMPLATE_PATTERN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/**
 * Replace `{{name}}` with the matching arg value. Unfilled args become "".
 * The pattern is intentionally strict — only declared snake_case names.
 */
export function renderPromptTemplate(template: string, args: Record<string, string>): string {
  return template.replace(TEMPLATE_PATTERN, (_match, name: string) => {
    const v = args[name];
    return v === undefined ? '' : v;
  });
}

/** Flat list of skill bundles across every loaded plugin. */
export function listSkillBundles(plugins: LoadedPlugin[]): SkillBundleDef[] {
  const out: SkillBundleDef[] = [];
  for (const p of plugins) {
    for (const s of p.manifest.skills) out.push(s);
  }
  return out;
}

/**
 * Verify a skill bundle's `tools` array references only known tool names.
 * Returns the missing ones so the founder/author knows exactly what to fix.
 */
export function validateSkillBundleTools(
  bundle: SkillBundleDef,
  knownToolNames: readonly string[],
): { ok: boolean; missing: string[] } {
  const known = new Set(knownToolNames);
  const missing = bundle.tools.filter((t) => !known.has(t));
  return { ok: missing.length === 0, missing };
}
