import { describe, it, expect } from 'vitest';
import {
  parsePluginManifest,
  PluginValidationError,
  PLUGIN_MANIFEST_SCHEMA,
} from '@/lib/plugins/manifest';

const minimal = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  author: 'Tester',
  description: 'Minimal plugin used by tests.',
};

const full = {
  id: 'full-plugin',
  name: 'Full Plugin',
  version: '2.10.3',
  author: 'Charles team',
  description: 'A plugin exercising every field.',
  homepage: 'https://example.com',
  slashCommands: [
    {
      name: 'do-it',
      description: 'Do the thing.',
      prompt: 'Do the thing with {{target}}.',
      args: [
        { name: 'target', description: 'What to do it to.', required: true },
      ],
    },
  ],
  skills: [
    {
      name: 'doer',
      description: 'Skill that does it.',
      instructions: 'You do the thing.',
      tools: ['recall_history'],
      model: 'gpt-5-mini',
    },
  ],
};

describe('parsePluginManifest — happy paths', () => {
  it('accepts a minimal manifest and fills defaults', () => {
    const m = parsePluginManifest(minimal);
    expect(m.id).toBe('demo');
    expect(m.slashCommands).toEqual([]);
    expect(m.skills).toEqual([]);
  });

  it('accepts a full manifest with all fields', () => {
    const m = parsePluginManifest(full);
    expect(m.slashCommands[0].args[0].required).toBe(true);
    expect(m.skills[0].tools).toEqual(['recall_history']);
    expect(m.homepage).toBe('https://example.com');
  });

  it('defaults args.required to false when omitted', () => {
    const m = parsePluginManifest({
      ...minimal,
      slashCommands: [
        {
          name: 'opt',
          description: 'Optional arg cmd.',
          prompt: 'Hi {{name}}.',
          args: [{ name: 'name', description: 'Whom to greet.' }],
        },
      ],
    });
    expect(m.slashCommands[0].args[0].required).toBe(false);
  });
});

describe('parsePluginManifest — required fields', () => {
  it.each(['id', 'name', 'version', 'author', 'description'])(
    'rejects when required field %s is missing',
    (field) => {
      const bad = { ...minimal } as Record<string, unknown>;
      delete bad[field];
      expect(() => parsePluginManifest(bad)).toThrow(PluginValidationError);
    },
  );
});

describe('parsePluginManifest — regex validation', () => {
  it('rejects id with uppercase', () => {
    expect(() => parsePluginManifest({ ...minimal, id: 'Demo' })).toThrow(PluginValidationError);
  });

  it('rejects id with underscore', () => {
    expect(() => parsePluginManifest({ ...minimal, id: 'demo_plugin' })).toThrow(
      PluginValidationError,
    );
  });

  it('rejects non-semver version', () => {
    expect(() => parsePluginManifest({ ...minimal, version: '1.0' })).toThrow(
      PluginValidationError,
    );
    expect(() => parsePluginManifest({ ...minimal, version: 'v1.0.0' })).toThrow(
      PluginValidationError,
    );
  });

  it('rejects name longer than 60 chars', () => {
    expect(() => parsePluginManifest({ ...minimal, name: 'x'.repeat(61) })).toThrow(
      PluginValidationError,
    );
  });

  it('rejects description longer than 280 chars', () => {
    expect(() => parsePluginManifest({ ...minimal, description: 'x'.repeat(281) })).toThrow(
      PluginValidationError,
    );
  });
});

describe('parsePluginManifest — slash command shape', () => {
  it('rejects slash command name with uppercase', () => {
    expect(() =>
      parsePluginManifest({
        ...minimal,
        slashCommands: [{ name: 'Bad', description: 'd', prompt: 'p' }],
      }),
    ).toThrow(PluginValidationError);
  });

  it('rejects slash command with empty prompt', () => {
    expect(() =>
      parsePluginManifest({
        ...minimal,
        slashCommands: [{ name: 'ok', description: 'd', prompt: '' }],
      }),
    ).toThrow(PluginValidationError);
  });

  it('rejects arg name not snake_case', () => {
    expect(() =>
      parsePluginManifest({
        ...minimal,
        slashCommands: [
          {
            name: 'cmd',
            description: 'd',
            prompt: 'p',
            args: [{ name: 'Bad-Name', description: 'd' }],
          },
        ],
      }),
    ).toThrow(PluginValidationError);
  });
});

describe('parsePluginManifest — skill bundle shape', () => {
  it('rejects skill name with dashes', () => {
    expect(() =>
      parsePluginManifest({
        ...minimal,
        skills: [{ name: 'bad-name', description: 'd', instructions: 'i' }],
      }),
    ).toThrow(PluginValidationError);
  });

  it('defaults skill.tools to []', () => {
    const m = parsePluginManifest({
      ...minimal,
      skills: [{ name: 'good_name', description: 'd', instructions: 'i' }],
    });
    expect(m.skills[0].tools).toEqual([]);
  });
});

describe('parsePluginManifest — limits', () => {
  it('rejects more than 50 slash commands', () => {
    const slashCommands = Array.from({ length: 51 }, (_, i) => ({
      name: `cmd-${i}`,
      description: 'd',
      prompt: 'p',
    }));
    expect(() => parsePluginManifest({ ...minimal, slashCommands })).toThrow(
      PluginValidationError,
    );
  });

  it('rejects more than 10 skill bundles', () => {
    const skills = Array.from({ length: 11 }, (_, i) => ({
      name: `skill_${i}`,
      description: 'd',
      instructions: 'i',
    }));
    expect(() => parsePluginManifest({ ...minimal, skills })).toThrow(PluginValidationError);
  });
});

describe('PluginValidationError', () => {
  it('surfaces ZodIssues with field paths', () => {
    try {
      parsePluginManifest({ ...minimal, id: 'BAD' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PluginValidationError);
      const e = err as PluginValidationError;
      expect(e.issues.length).toBeGreaterThan(0);
      expect(e.issues[0].path).toContain('id');
      expect(e.message).toContain('id');
    }
  });

  it('PLUGIN_MANIFEST_SCHEMA is exported', () => {
    expect(PLUGIN_MANIFEST_SCHEMA.safeParse(minimal).success).toBe(true);
  });
});
