import { describe, it, expect } from 'vitest';
import path from 'node:path';

import { loadPlugins, validateSkillBundleTools } from '@/lib/plugins/loader';
import { ALL_TOOLS } from '@/lib/ai-tools/tools';

const SAMPLES_DIR = path.join(process.cwd(), 'plugins');
const EXPECTED_IDS = ['competitor-watch', 'daily-standup', 'fundraise-prep'].sort();

describe('shipped sample plugins', () => {
  it('all sample manifests parse cleanly with no errors', async () => {
    const res = await loadPlugins({ pluginsDir: SAMPLES_DIR });
    expect(res.errors).toEqual([]);
    expect(res.plugins.map((p) => p.manifest.id).sort()).toEqual(EXPECTED_IDS);
  });

  it('every skill bundle references only tools in ALL_TOOLS', async () => {
    const known = ALL_TOOLS.map((t) => t.name);
    const res = await loadPlugins({ pluginsDir: SAMPLES_DIR });
    const offenders: string[] = [];
    for (const plugin of res.plugins) {
      for (const skill of plugin.manifest.skills) {
        const check = validateSkillBundleTools(skill, known);
        if (!check.ok) {
          offenders.push(`${plugin.manifest.id}/${skill.name}: ${check.missing.join(', ')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every sample plugin has at least one slash command or skill', async () => {
    const res = await loadPlugins({ pluginsDir: SAMPLES_DIR });
    for (const p of res.plugins) {
      const total = p.manifest.slashCommands.length + p.manifest.skills.length;
      expect(total, `${p.manifest.id} should ship something`).toBeGreaterThan(0);
    }
  });
});
