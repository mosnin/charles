import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function EngineeringDatabase({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No database connected."
      hint="Connect Supabase to see tables and run read-only queries from here."
      cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
    />
  );
}
