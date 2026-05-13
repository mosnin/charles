import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function MarketingSocial({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No social posts yet."
      hint="Connect Twitter or LinkedIn so Charles can draft and queue posts for approval."
      cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
    />
  );
}
