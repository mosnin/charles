import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function SupportInbox({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="Inbox is quiet."
      hint="Customer email and helpdesk threads land here once you connect a provider."
      cta={{ label: 'Open inbox', href: `/s/${spaceSlug}/inbox` }}
    />
  );
}
