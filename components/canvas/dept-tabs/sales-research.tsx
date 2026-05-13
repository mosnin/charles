/**
 * Sales › Research contacts — placeholder until enrichment lands.
 */

import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function SalesResearch({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="Research is coming."
      hint="Connect Apollo or Clearbit to enrich and research contacts here."
      cta={{ label: 'Open integrations', href: `/s/${spaceSlug}/integrations` }}
    />
  );
}
