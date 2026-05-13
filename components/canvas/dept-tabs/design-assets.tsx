import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function DesignAssets({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No assets generated."
      hint="Generate a logo or hero image from chat. Charles holds it for your approval."
      cta={{ label: 'Open in brand builder', href: `/s/${spaceSlug}/brand` }}
    />
  );
}
