/**
 * Charles mascot — a pixel-art sapling. The official asset lives at
 * /public/sapling.svg (Agent A); this component renders it as a
 * next/image so it stays crisp at any size and ships as a static asset.
 */

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface Props {
  size?: number;
  /** Use the monochrome variant (`sapling-mono.svg`) — for dark surfaces. */
  mono?: boolean;
  className?: string;
}

export function Sapling({ size = 32, mono = false, className }: Props) {
  const src = mono ? '/sapling-mono.svg' : '/sapling.svg';
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('inline-block', className)}
      style={{ width: size, height: size }}
      aria-hidden
      priority
    />
  );
}
