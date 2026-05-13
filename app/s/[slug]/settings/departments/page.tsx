import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import {
  ALL_DEPARTMENTS,
  DEPARTMENT_NAMES,
  getAllDepartmentAutonomy,
  type DepartmentSlug,
} from '@/lib/departments/autonomy';
import { AutonomyRow } from './autonomy-row';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  PAGE_RHYTHM,
  READING_MAX,
} from '@/lib/typography';

/**
 * One page, one job: dial each department's autonomy level. No tabs, no
 * panels, no per-department settings page. The level names are the
 * contract — we do not narrate them here. If the founder needs to look up
 * what "auto-low" means, the docs link in the corner is enough.
 */
export default async function DepartmentsSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const levels = await getAllDepartmentAutonomy(space.id);

  // One-line role for each department — read directly off the PRODUCT_SCOPE
  // copy. Kept short on purpose. If a line wants a second clause, cut it.
  const ROLES: Record<DepartmentSlug, string> = {
    engineering: 'Writes, reviews, and ships code.',
    design: 'Owns the logo, the landing page, the brand.',
    marketing: 'Writes copy, posts to social, runs launches.',
    sales: 'Finds prospects, runs the pipeline, books calls.',
    support: 'Triages the inbox and answers customers.',
    ops_finance: 'Handles billing, expenses, and weekly reporting.',
  };

  return (
    <div className={`${PAGE_RHYTHM} ${READING_MAX}`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Settings.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Departments
        </h1>
        <p className={BODY_MUTED}>
          Decide how much each part of Charles is allowed to do without you.
        </p>
      </header>

      <section className="divide-y divide-border/60 border-y border-border/60">
        {ALL_DEPARTMENTS.map((dept) => (
          <AutonomyRow
            key={dept}
            slug={dept}
            name={DEPARTMENT_NAMES[dept]}
            role={ROLES[dept]}
            initialLevel={levels[dept]}
          />
        ))}
      </section>
    </div>
  );
}
