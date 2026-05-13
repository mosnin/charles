import { EmptyState } from './empty-state';

interface Props {
  spaceSlug: string;
}

export function SupportTemplates({ spaceSlug }: Props) {
  return (
    <EmptyState
      title="No templates yet."
      hint="Save a reply once and Charles reuses it on the next ticket."
      cta={{ label: 'Open inbox', href: `/s/${spaceSlug}/inbox` }}
    />
  );
}
