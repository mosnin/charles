/**
 * Catalog-level lockdown for the Tasks feature. The labels, the slug list,
 * and the isOpen matrix are all things the UI and the API depend on; if
 * they drift, both surfaces break silently.
 */

import { describe, it, expect } from 'vitest';
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  DEPARTMENT_LABELS,
  DEPARTMENT_SLUGS,
  TASK_STATUSES,
  TASK_PRIORITIES,
  isOpen,
  isDepartmentSlug,
  isTaskStatus,
  isTaskPriority,
  type TaskStatus,
  type TaskPriority,
} from '@/lib/tasks/catalog';

describe('STATUS_LABELS', () => {
  it('has a non-empty label for every status', () => {
    const expected: TaskStatus[] = ['open', 'in_progress', 'done', 'cancelled'];
    for (const s of expected) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(typeof STATUS_LABELS[s]).toBe('string');
    }
  });

  it('has exactly four entries', () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual(
      ['cancelled', 'done', 'in_progress', 'open'].sort(),
    );
  });

  it('uses sentence case (no title case, no shouting)', () => {
    for (const label of Object.values(STATUS_LABELS)) {
      expect(label).not.toMatch(/[A-Z]{2,}/);
    }
  });
});

describe('PRIORITY_LABELS', () => {
  it('has a label for low / normal / high', () => {
    const expected: TaskPriority[] = ['low', 'normal', 'high'];
    for (const p of expected) {
      expect(PRIORITY_LABELS[p]).toBeTruthy();
    }
  });

  it('has exactly three entries', () => {
    expect(Object.keys(PRIORITY_LABELS).sort()).toEqual(['high', 'low', 'normal']);
  });
});

describe('DEPARTMENT_LABELS / DEPARTMENT_SLUGS', () => {
  it('covers all six Charles departments', () => {
    expect(DEPARTMENT_SLUGS).toHaveLength(6);
    expect([...DEPARTMENT_SLUGS].sort()).toEqual(
      ['design', 'engineering', 'marketing', 'ops_finance', 'sales', 'support'].sort(),
    );
  });

  it('every slug has a non-empty label', () => {
    for (const slug of DEPARTMENT_SLUGS) {
      expect(DEPARTMENT_LABELS[slug]).toBeTruthy();
    }
  });
});

describe('TASK_STATUSES / TASK_PRIORITIES', () => {
  it('TASK_STATUSES matches STATUS_LABELS keys', () => {
    expect([...TASK_STATUSES].sort()).toEqual(Object.keys(STATUS_LABELS).sort());
  });

  it('TASK_PRIORITIES matches PRIORITY_LABELS keys', () => {
    expect([...TASK_PRIORITIES].sort()).toEqual(Object.keys(PRIORITY_LABELS).sort());
  });
});

describe('isOpen', () => {
  it('returns true for open + in_progress', () => {
    expect(isOpen('open')).toBe(true);
    expect(isOpen('in_progress')).toBe(true);
  });

  it('returns false for done + cancelled', () => {
    expect(isOpen('done')).toBe(false);
    expect(isOpen('cancelled')).toBe(false);
  });

  it('covers the full TaskStatus space', () => {
    let liveCount = 0;
    for (const s of TASK_STATUSES) if (isOpen(s)) liveCount++;
    expect(liveCount).toBe(2);
  });
});

describe('type guards', () => {
  it('isDepartmentSlug accepts valid + rejects bogus', () => {
    expect(isDepartmentSlug('engineering')).toBe(true);
    expect(isDepartmentSlug('ops_finance')).toBe(true);
    expect(isDepartmentSlug('finance')).toBe(false);
    expect(isDepartmentSlug('')).toBe(false);
    expect(isDepartmentSlug('ENGINEERING')).toBe(false);
  });

  it('isTaskStatus accepts the four canonical statuses', () => {
    expect(isTaskStatus('open')).toBe(true);
    expect(isTaskStatus('in_progress')).toBe(true);
    expect(isTaskStatus('done')).toBe(true);
    expect(isTaskStatus('cancelled')).toBe(true);
    expect(isTaskStatus('archived')).toBe(false);
    expect(isTaskStatus('')).toBe(false);
  });

  it('isTaskPriority accepts low / normal / high only', () => {
    expect(isTaskPriority('low')).toBe(true);
    expect(isTaskPriority('normal')).toBe(true);
    expect(isTaskPriority('high')).toBe(true);
    expect(isTaskPriority('urgent')).toBe(false);
    expect(isTaskPriority('')).toBe(false);
  });
});
