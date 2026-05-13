import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function MarketingImages({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No images generated."
      hint="Connect OpenAI Images or Replicate to generate launch assets from chat."
      cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
    />
  );
}
