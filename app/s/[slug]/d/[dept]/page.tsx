/**
 * Department detail page — /s/[slug]/d/[dept].
 *
 * All six departments render through the unified DepartmentPage template:
 * connections strip + live "in flight" strip + filter pills + activity
 * feed. Per-dept differences (filter labels, toolkit list, keyword
 * classifier) live in `lib/departments/page-config.ts`.
 *
 * Validation: bad dept slug → 404. Auth: required.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { getDepartmentConfig } from '@/lib/departments/workflows';
import { DepartmentPage } from '@/components/canvas/department-page';
import { loadDepartmentFeed } from '@/lib/departments/feed';

interface PageProps {
  params: Promise<{ slug: string; dept: string }>;
}

export default async function DepartmentDetailPage({ params }: PageProps) {
  const { slug, dept } = await params;

  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const config = getDepartmentConfig(dept);
  if (!config) notFound();

  const feed = await loadDepartmentFeed(space.id, config.slug);
  if (!feed) notFound();

  return (
    <DepartmentPage
      workflowConfig={config}
      feed={feed}
      spaceId={space.id}
      spaceSlug={space.slug}
    />
  );
}
