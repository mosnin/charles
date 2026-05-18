import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { WizardClient } from './wizard-client';

export const metadata = { title: 'Set up Charles' };

/**
 * Server-side gate for the Charles onboarding wizard.
 * If the user already has a space, send them to their dashboard.
 */
export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const clerkUser = await currentUser();
  if (!clerkUser) redirect('/sign-in');

  // Resolve DB user and space
  try {
    const { data: row } = await supabase
      .from('User')
      .select('id, name, onboard')
      .eq('clerkId', userId)
      .maybeSingle();

    if (row) {
      const { data: spaceRow } = await supabase
        .from('Space')
        .select('slug')
        .eq('ownerId', row.id)
        .maybeSingle();

      if (spaceRow?.slug) {
        redirect(`/s/${spaceRow.slug}`);
      }
    }
  } catch {
    // Non-fatal — render the form anyway
  }

  const defaultFounderName =
    clerkUser.fullName ?? clerkUser.firstName ?? '';

  return <WizardClient defaultFounderName={defaultFounderName} />;
}
