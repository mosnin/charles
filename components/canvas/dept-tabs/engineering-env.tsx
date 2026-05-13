import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function EngineeringEnv({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No environment configured."
      hint="Connect Vercel and Cloudflare to manage env vars and DNS records from here."
      cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
    />
  );
}
