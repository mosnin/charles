/**
 * /s/[slug]/brand — Brand Builder wizard entry.
 *
 * Server gate: owner-only. We pass the space slug and the existing company
 * name (if any) so the wizard can pre-fill the logo prompt sensibly.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { BrandWizardClient } from './wizard-client';

export const metadata = { title: 'Brand kit' };

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BrandWizardPage({ params }: PageProps) {
  const { slug } = await params;

  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const result = await requireSpaceOwner(slug);
  // requireSpaceOwner returns a NextResponse on failure; in a server page we
  // route those to 404 to avoid leaking existence.
  if (result instanceof Response) {
    notFound();
  }
  const { space } = result;

  // Pull the executive-summary doc (if any) for a hint at the company name.
  // The wizard works fine without it.
  let companyName = space.name ?? '';
  try {
    const { data } = await supabase
      .from('Document')
      .select('content')
      .eq('spaceId', space.id)
      .eq('slug', 'executive-summary')
      .maybeSingle();
    const content = (data as { content?: string } | null)?.content ?? '';
    // Best-effort: pull the first H1 if present
    const m = content.match(/^#\s+(.+)$/m);
    if (m && m[1]) companyName = m[1].trim();
  } catch {
    // Non-fatal
  }

  return <BrandWizardClient slug={space.slug} companyName={companyName} />;
}
