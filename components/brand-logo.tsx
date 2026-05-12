import { cn } from '@/lib/utils';

interface BrandLogoProps {
  className?: string;
  alt?: string;
}

/**
 * Charles wordmark. Per STYLESHEET.md, v1 is wordmark only — no logo mark.
 * Renders the text "Charles" in the brand font, weight 600.
 *
 * The `alt` prop is retained for API compatibility and surfaces as an
 * accessible label.
 */
export function BrandLogo({ className, alt = 'Charles' }: BrandLogoProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold tracking-tight text-foreground',
        className
      )}
      aria-label={alt}
    >
      Charles
    </span>
  );
}
