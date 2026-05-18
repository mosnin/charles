'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';

import { navLinks } from '@/lib/nav-links';

// TODO: cleanup phase 1B — restore mega menu once Charles marketing pages exist.

interface NavItem {
  id: number;
  name: string;
  href: string;
}

const navs: NavItem[] = [...navLinks];

export function NavMenu() {
  const ref = useRef<HTMLUListElement>(null);
  const pathname = usePathname();
  const [left, setLeft] = useState(0);
  const [width, setWidth] = useState(0);
  const [isReady, setIsReady] = useState(false);

  const activeHref = navs.find((n) => {
    if (n.href === '/') return pathname === '/';
    return pathname.startsWith(n.href);
  })?.href ?? '/';

  useEffect(() => {
    const activeItem = ref.current?.querySelector<HTMLElement>(
      `[data-href="${activeHref}"]`
    )?.parentElement;
    if (activeItem) {
      setLeft(activeItem.offsetLeft);
      setWidth(activeItem.getBoundingClientRect().width);
      setIsReady(true);
    }
  }, [activeHref]);

  return (
    <div className="hidden w-full md:block relative">
      <ul
        className="relative mx-auto flex h-11 w-fit items-center justify-center rounded-full px-2"
        ref={ref}
      >
        {navs.map((item) => (
          <li
            key={item.id}
            className={`tracking-tight z-10 flex h-full cursor-pointer items-center justify-center px-4 py-2 text-sm font-medium transition-colors duration-200 ${
              activeHref === item.href ? 'text-primary' : 'text-primary/60 hover:text-primary'
            }`}
          >
            <Link href={item.href} data-href={item.href}>
              {item.name}
            </Link>
          </li>
        ))}
        {isReady && (
          <motion.li
            animate={{ left, width }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="bg-accent/60 border-border absolute inset-0 my-1.5 rounded-full border"
          />
        )}
      </ul>
    </div>
  );
}
