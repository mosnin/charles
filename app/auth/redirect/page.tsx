import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * /auth/redirect
 *
 * Called after Clerk sign-in. Every user lands on their workspace, or
 * /setup if they don't have one yet. The realtor-era Brokerage invitation
 * acceptance flow that used to redirect here was removed with the
 * Brokerage / Invitation tables; the Charles Team invite acceptance flow
 * will hook back in when it lands.
 */
export default async function AuthRedirectPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const { data: user } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .maybeSingle();

  if (!user) {
    redirect('/setup');
  }

  const { data: space } = await supabase
    .from('Space')
    .select('slug')
    .eq('ownerId', user.id)
    .maybeSingle();

  if (space?.slug) {
    redirect(`/s/${space.slug}`);
  }

  redirect('/setup');
}
