import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function OpsRunway({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="Runway needs revenue and expenses."
      hint="Connect Stripe and your bank to compute months remaining."
      cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
    />
  );
}
