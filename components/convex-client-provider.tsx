/**
 * Convex client provider, mounted inside ClerkProvider.
 *
 * Convex authenticates each subscription using the Clerk JWT under the
 * "convex" template; `ConvexProviderWithClerk` wires Clerk's `useAuth`
 * hook into the Convex client so the JWT refreshes automatically. The
 * URL comes from `NEXT_PUBLIC_CONVEX_URL`, populated by `npx convex dev`.
 */
'use client';

import { ReactNode, useMemo } from 'react';
import { ConvexReactClient } from 'convex/react';
import { useAuth } from '@clerk/nextjs';
import { ConvexProviderWithClerk } from 'convex/react-clerk';

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Memoize so the client survives re-renders. If the URL isn't set (e.g.
  // local dev before the founder ran `npx convex dev`) we render children
  // without the provider — the live-state features just won't work.
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    return new ConvexReactClient(url);
  }, []);

  if (!client) return <>{children}</>;

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
