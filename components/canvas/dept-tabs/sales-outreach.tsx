/**
 * Sales › Send Outreach Emails — placeholder until outbound lands.
 */

import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function SalesOutreach({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No outreach queued."
      hint="Draft a campaign from chat. Charles holds it for your approval before it sends."
      cta={{ label: 'Go to inbox', href: `/s/${spaceSlug}/inbox` }}
    />
  );
}
