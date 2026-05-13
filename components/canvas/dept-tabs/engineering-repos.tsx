/**
 * Engineering › Repos — empty state until the GitHub adapter exposes a
 * list-repos function. The adapter currently only has create/read/PR; we
 * are NOT adding a new endpoint as part of this surface — that's a
 * separate change.
 */

import { EmptyState } from './empty-state';
import { supabase } from '@/lib/supabase';

interface Props {
  spaceId: string;
  spaceSlug: string;
}

async function isGithubConnected(spaceId: string): Promise<boolean> {
  if (process.env.GITHUB_ACCESS_TOKEN) return true;
  try {
    const { data } = await supabase
      .from('IntegrationConnection')
      .select('accessToken, status')
      .eq('spaceId', spaceId)
      .eq('toolkit', 'github')
      .eq('status', 'active')
      .maybeSingle();
    return Boolean((data as { accessToken?: string } | null)?.accessToken);
  } catch {
    return false;
  }
}

export async function EngineeringRepos({ spaceId, spaceSlug }: Props) {
  const connected = await isGithubConnected(spaceId);
  if (!connected) {
    return (
      <EmptyState
        title="Connect GitHub to see your repos."
        cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
      />
    );
  }
  return (
    <EmptyState
      title="GitHub connected."
      hint="Repo listing lands soon. For now, open repos directly on GitHub."
    />
  );
}
