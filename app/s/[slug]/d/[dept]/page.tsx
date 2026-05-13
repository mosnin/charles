/**
 * Department detail page — /s/[slug]/d/[dept].
 *
 * One page per department, with sub-tabs across the top mirroring the
 * cofounder.co dept screens. Tab state lives in the URL (?tab=...) so the
 * page is server-rendered and shareable.
 *
 * Validation: bad dept slug → 404. Bad tab slug → fall back to the
 * department's default tab. Auth: required; no owner gate (read-only view).
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import {
  getDepartmentConfig,
  getDepartmentTab,
} from '@/lib/departments/workflows';
import { DeptTabNav } from '@/components/canvas/dept-tab-nav';
import { DeptTabContent } from '@/components/canvas/dept-tab-content';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  PAGE_MAX,
} from '@/lib/typography';

interface PageProps {
  params: Promise<{ slug: string; dept: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function DepartmentDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { slug, dept } = await params;
  const { tab } = await searchParams;

  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const config = getDepartmentConfig(dept);
  if (!config) notFound();

  // Resolve requested tab; fall back to default if it doesn't exist.
  const requested = tab ? getDepartmentTab(dept, tab) : null;
  const activeTab = requested ?? config.tabs.find((t) => t.slug === config.defaultTab) ?? config.tabs[0];

  return (
    <div className={`${PAGE_RHYTHM} ${PAGE_MAX} mx-auto px-6 py-8`}>
      <header className="space-y-2">
        <h1 className={H1} style={TITLE_FONT}>
          {config.name}
        </h1>
        <p className={BODY_MUTED}>{config.blurb}</p>
      </header>

      <DeptTabNav
        spaceSlug={space.slug}
        deptSlug={config.slug}
        tabs={config.tabs}
        activeSlug={activeTab.slug}
      />

      <DeptTabContent
        deptSlug={config.slug}
        tabSlug={activeTab.slug}
        spaceId={space.id}
        spaceSlug={space.slug}
      />
    </div>
  );
}
