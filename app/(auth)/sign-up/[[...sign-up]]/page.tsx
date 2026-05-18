import type { Metadata } from 'next';
import { CharlesAuthShell } from '@/components/auth/charles-auth-shell';
import { ThemedSignUp } from '@/components/auth/clerk-sign-up';

/**
 * `/sign-up` — the Charles sign-up page.
 *
 * Same layout as `/sign-in`. Clerk's <SignUp /> is rendered inside the
 * themed client wrapper.
 *
 * H1: "Start with Charles."
 * Sub: "One workspace, one mission, one cofounder."
 *
 * Post-sign-up: send the new founder to `/onboarding` so the wizard runs
 * before they hit the workspace.
 */

export const metadata: Metadata = { title: 'Start with Charles' };

const HEADING = 'Start with Charles.';
const SUBHEADING = 'One workspace, one mission, one cofounder.';
const POST_SIGN_UP_URL = '/onboarding';
const SIGN_IN_URL = '/sign-in';

export default function SignUpPage() {
  return (
    <CharlesAuthShell heading={HEADING} subheading={SUBHEADING}>
      <ThemedSignUp
        routing="path"
        path="/sign-up"
        forceRedirectUrl={POST_SIGN_UP_URL}
        signInUrl={SIGN_IN_URL}
      />
    </CharlesAuthShell>
  );
}
