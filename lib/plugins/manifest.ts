/**
 * Plugin manifest schema.
 *
 * Plugins ship two declarative artifacts: slash commands (prompt templates a
 * founder can invoke) and skill bundles (sub-agent definitions). Everything
 * is data — no executable code crosses the boundary. The schema is the
 * contract; the runtime owns execution.
 */

import { z } from 'zod';

/** Per-plugin caps. Loud-fail rather than silently mis-render giant manifests. */
export const MAX_SLASH_COMMANDS_PER_PLUGIN = 50;
export const MAX_SKILL_BUNDLES_PER_PLUGIN = 10;

export const SLASH_COMMAND_ARG_SCHEMA = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'arg names must be lowercase snake_case'),
  description: z.string().min(1).max(140),
  required: z.boolean().default(false),
});

export const SLASH_COMMAND_SCHEMA = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slash command names must be lowercase, digits, or "-"'),
  description: z.string().min(1).max(140),
  prompt: z.string().min(1),
  args: z.array(SLASH_COMMAND_ARG_SCHEMA).default([]),
});

export const SKILL_BUNDLE_SCHEMA = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'skill names must be lowercase snake_case'),
  description: z.string().min(1).max(140),
  instructions: z.string().min(1),
  tools: z.array(z.string()).default([]),
  model: z.string().min(1).optional(),
});

export const PLUGIN_MANIFEST_SCHEMA = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'plugin id must be lowercase, digits, or "-"'),
  name: z.string().min(1).max(60),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'version must be semver MAJOR.MINOR.PATCH'),
  author: z.string().min(1),
  description: z.string().min(1).max(280),
  homepage: z.string().url().optional(),
  slashCommands: z
    .array(SLASH_COMMAND_SCHEMA)
    .max(MAX_SLASH_COMMANDS_PER_PLUGIN)
    .default([]),
  skills: z
    .array(SKILL_BUNDLE_SCHEMA)
    .max(MAX_SKILL_BUNDLES_PER_PLUGIN)
    .default([]),
});

export type SlashCommandArg = z.infer<typeof SLASH_COMMAND_ARG_SCHEMA>;
export type SlashCommandDef = z.infer<typeof SLASH_COMMAND_SCHEMA>;
export type SkillBundleDef = z.infer<typeof SKILL_BUNDLE_SCHEMA>;
export type PluginManifest = z.infer<typeof PLUGIN_MANIFEST_SCHEMA>;

/**
 * Thrown by `parsePluginManifest` when validation fails. Carries the raw
 * Zod issues so callers can render the precise field path.
 */
export class PluginValidationError extends Error {
  public readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = 'PluginValidationError';
    this.issues = issues;
  }
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((i) => {
      const path = i.path.length === 0 ? '(root)' : i.path.join('.');
      return `${path}: ${i.message}`;
    })
    .join('; ');
}

/**
 * Parse an unknown JSON value into a validated PluginManifest.
 * Throws PluginValidationError when invalid.
 */
export function parsePluginManifest(json: unknown): PluginManifest {
  const result = PLUGIN_MANIFEST_SCHEMA.safeParse(json);
  if (!result.success) {
    throw new PluginValidationError(
      `Invalid plugin manifest: ${formatZodIssues(result.error.issues)}`,
      result.error.issues,
    );
  }
  return result.data;
}
