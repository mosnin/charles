import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function EngineeringDeploys({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No deploys yet."
      hint="Connect Vercel to see recent deploys and roll back from here."
      cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
    />
  );
}
