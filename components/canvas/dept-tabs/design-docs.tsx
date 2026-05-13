import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function DesignDocs({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No style docs yet."
      hint="Style docs live alongside your brand kit. Add notes from chat."
      cta={{ label: 'Open documents', href: `/s/${spaceSlug}/documents` }}
    />
  );
}
