import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadPlugins,
  resolveSlashCommand,
  renderPromptTemplate,
  listSkillBundles,
  validateSkillBundleTools,
  type LoadedPlugin,
} from '@/lib/plugins/loader';
import type { PluginManifest } from '@/lib/plugins/manifest';

let tmp = '';

async function writePlugin(id: string, manifest: unknown) {
  const dir = path.join(tmp, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

const baseManifest = (overrides: Partial<PluginManifest> = {}) => ({
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  author: 'Tester',
  description: 'Demo plugin.',
  ...overrides,
});

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'plugins-loader-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('loadPlugins', () => {
  it('returns empty result for a missing plugins dir', async () => {
    const res = await loadPlugins({ pluginsDir: path.join(tmp, 'does-not-exist') });
    expect(res.plugins).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it('discovers and parses valid plugins', async () => {
    await writePlugin(
      'alpha',
      baseManifest({
        id: 'alpha',
        slashCommands: [{ name: 'hello', description: 'Say hi.', prompt: 'Hi.' }],
      }),
    );
    await writePlugin(
      'beta',
      baseManifest({
        id: 'beta',
        skills: [{ name: 'doer', description: 'd', instructions: 'i' }],
      }),
    );
    const res = await loadPlugins({ pluginsDir: tmp });
    expect(res.errors).toEqual([]);
    expect(res.plugins.map((p) => p.manifest.id).sort()).toEqual(['alpha', 'beta']);
  });

  it('reports invalid JSON in errors and does not throw', async () => {
    const dir = path.join(tmp, 'broken');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'plugin.json'), '{ not valid json');
    const res = await loadPlugins({ pluginsDir: tmp });
    expect(res.plugins).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reason).toContain('invalid JSON');
  });

  it('reports invalid manifest in errors and does not throw', async () => {
    await writePlugin('badmanifest', { id: 'BAD ID', name: 'x', version: 'nope' });
    const res = await loadPlugins({ pluginsDir: tmp });
    expect(res.plugins).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reason).toContain('Invalid plugin manifest');
  });

  it('skips subdirectories with no plugin.json', async () => {
    await mkdir(path.join(tmp, 'just-a-folder'), { recursive: true });
    await writePlugin('valid', baseManifest({ id: 'valid' }));
    const res = await loadPlugins({ pluginsDir: tmp });
    expect(res.plugins.map((p) => p.manifest.id)).toEqual(['valid']);
    expect(res.errors).toEqual([]);
  });

  it('rejects duplicate plugin ids', async () => {
    const a = path.join(tmp, 'first');
    const b = path.join(tmp, 'second');
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(path.join(a, 'plugin.json'), JSON.stringify(baseManifest({ id: 'dup' })));
    await writeFile(path.join(b, 'plugin.json'), JSON.stringify(baseManifest({ id: 'dup' })));
    const res = await loadPlugins({ pluginsDir: tmp });
    expect(res.plugins).toHaveLength(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reason).toContain('duplicate plugin id');
  });

  it('warns on slash command collisions across plugins', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writePlugin(
      'a-plugin',
      baseManifest({
        id: 'a-plugin',
        slashCommands: [{ name: 'shared', description: 'd', prompt: 'p' }],
      }),
    );
    await writePlugin(
      'b-plugin',
      baseManifest({
        id: 'b-plugin',
        slashCommands: [{ name: 'shared', description: 'd', prompt: 'p' }],
      }),
    );
    await loadPlugins({ pluginsDir: tmp });
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('shared');
  });
});

function makeLoaded(manifest: PluginManifest): LoadedPlugin {
  return { manifest, pluginDir: '/tmp/fake' };
}

describe('resolveSlashCommand', () => {
  const plugins: LoadedPlugin[] = [
    makeLoaded({
      id: 'standup-pack',
      name: 'Standup',
      version: '0.1.0',
      author: 't',
      description: 'd',
      slashCommands: [
        {
          name: 'standup',
          description: 'd',
          prompt: 'Hello {{topic}}.',
          args: [{ name: 'topic', description: 't', required: false }],
        },
      ],
      skills: [],
    }),
  ];

  it('returns null for non-slash input', () => {
    expect(resolveSlashCommand(plugins, 'just a message')).toBeNull();
  });

  it('returns null for unknown command', () => {
    expect(resolveSlashCommand(plugins, '/nope')).toBeNull();
  });

  it('resolves /standup and binds positional args', () => {
    const res = resolveSlashCommand(plugins, '/standup yesterday');
    expect(res).not.toBeNull();
    expect(res!.command.name).toBe('standup');
    expect(res!.args).toEqual({ topic: 'yesterday' });
    expect(res!.plugin.manifest.id).toBe('standup-pack');
  });

  it('handles quoted args with spaces', () => {
    const res = resolveSlashCommand(plugins, '/standup "yesterday and today"');
    expect(res!.args).toEqual({ topic: 'yesterday and today' });
  });

  it('drops extra positional args beyond declared args', () => {
    const res = resolveSlashCommand(plugins, '/standup one two three');
    expect(res!.args).toEqual({ topic: 'one' });
  });

  it('leaves unfilled positional args unset', () => {
    const res = resolveSlashCommand(plugins, '/standup');
    expect(res!.args).toEqual({});
  });
});

describe('renderPromptTemplate', () => {
  it('replaces a single {{arg}}', () => {
    expect(renderPromptTemplate('Hi {{name}}.', { name: 'Alex' })).toBe('Hi Alex.');
  });

  it('replaces with whitespace inside braces', () => {
    expect(renderPromptTemplate('Hi {{ name }}.', { name: 'Alex' })).toBe('Hi Alex.');
  });

  it('substitutes empty string for missing args', () => {
    expect(renderPromptTemplate('Hi {{name}}.', {})).toBe('Hi .');
  });

  it('handles multiple substitutions', () => {
    expect(
      renderPromptTemplate('{{greeting}}, {{name}}!', { greeting: 'Hey', name: 'Alex' }),
    ).toBe('Hey, Alex!');
  });

  it('ignores invalid placeholder forms', () => {
    expect(renderPromptTemplate('Hi {{Bad-Name}}.', { 'Bad-Name': 'x' })).toBe('Hi {{Bad-Name}}.');
  });
});

describe('listSkillBundles', () => {
  it('returns flat list across plugins', () => {
    const ps: LoadedPlugin[] = [
      makeLoaded({
        id: 'a',
        name: 'a',
        version: '1.0.0',
        author: 't',
        description: 'd',
        slashCommands: [],
        skills: [
          { name: 'one', description: 'd', instructions: 'i', tools: [] },
          { name: 'two', description: 'd', instructions: 'i', tools: [] },
        ],
      }),
      makeLoaded({
        id: 'b',
        name: 'b',
        version: '1.0.0',
        author: 't',
        description: 'd',
        slashCommands: [],
        skills: [{ name: 'three', description: 'd', instructions: 'i', tools: [] }],
      }),
    ];
    expect(listSkillBundles(ps).map((s) => s.name)).toEqual(['one', 'two', 'three']);
  });
});

describe('validateSkillBundleTools', () => {
  const known = ['recall_history', 'find_person', 'create_plan'] as const;

  it('returns ok when all tools are in the catalog', () => {
    expect(
      validateSkillBundleTools(
        { name: 's', description: 'd', instructions: 'i', tools: ['recall_history'] },
        known,
      ),
    ).toEqual({ ok: true, missing: [] });
  });

  it('reports missing tool names', () => {
    expect(
      validateSkillBundleTools(
        { name: 's', description: 'd', instructions: 'i', tools: ['recall_history', 'made_up'] },
        known,
      ),
    ).toEqual({ ok: false, missing: ['made_up'] });
  });

  it('returns ok for an empty tools array', () => {
    expect(
      validateSkillBundleTools({ name: 's', description: 'd', instructions: 'i', tools: [] }, known),
    ).toEqual({ ok: true, missing: [] });
  });
});
