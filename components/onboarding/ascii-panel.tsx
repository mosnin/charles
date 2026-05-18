/**
 * AsciiPanel — renders the onboarding identity artwork in a monospace block.
 *
 * Two variants: a stylized "sunflower" (mascot for the warm interview feel)
 * and a tall "wordmark" reading "Charles". The strings live in lib/onboarding
 * so they can be unit-tested without pulling React into the test suite.
 */

import { SUNFLOWER_ASCII, WORDMARK_ASCII } from '@/lib/onboarding/ascii';
import { cn } from '@/lib/utils';

interface AsciiPanelProps {
  artwork: 'sunflower' | 'wordmark';
  className?: string;
}

export function AsciiPanel({ artwork, className }: AsciiPanelProps) {
  const content = artwork === 'sunflower' ? SUNFLOWER_ASCII : WORDMARK_ASCII;
  const tone =
    artwork === 'sunflower'
      ? 'text-foreground/70'
      : 'text-muted-foreground';

  return (
    <pre
      aria-hidden
      className={cn(
        'font-mono text-[10px] leading-[1.1] sm:text-xs select-none whitespace-pre',
        tone,
        className,
      )}
    >
      {content}
    </pre>
  );
}
