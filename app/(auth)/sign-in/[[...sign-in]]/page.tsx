import type { Metadata } from 'next';
import { CharlesAuthShell } from '@/components/auth/charles-auth-shell';
import { ThemedSignIn } from '@/components/auth/clerk-sign-in';

/**
 * `/sign-in` — the Charles sign-in page.
 *
 * Server component; Clerk's <SignIn /> is rendered inside the themed client
 * wrapper. Layout: dotted-grid full-screen, focal card on the left, quiet
 * display surface on the right. On mobile the right half hides; the card
 * fills the column.
 *
 * H1: "Welcome back."
 * Sub: "Pick up where Charles left off."
 *
 * Post-auth, Clerk forwards to `/onboarding`, which gates: existing space →
 * `/s/{slug}`; new user → wizard.
 */

export const metadata: Metadata = { title: 'Sign in to Charles' };

const HEADING = 'Welcome back.';
const SUBHEADING = 'Pick up where Charles left off.';
const POST_SIGN_IN_URL = '/onboarding';
const SIGN_UP_URL = '/sign-up';

export default function SignInPage() {
  return (
    <CharlesAuthShell heading={HEADING} subheading={SUBHEADING}>
      <ThemedSignIn
        routing="path"
        path="/sign-in"
        forceRedirectUrl={POST_SIGN_IN_URL}
        signUpUrl={SIGN_UP_URL}
      />
    </CharlesAuthShell>
  );
}
