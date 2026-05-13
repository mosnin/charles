import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function OpsExpenses({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No expenses tracked."
      hint="Connect Mercury or a card feed so Charles can categorize spend."
      cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
    />
  );
}
