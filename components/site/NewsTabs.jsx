'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/news', label: 'News', exact: true },
  { href: '/news/highlights', label: 'Highlights' },
];

export default function NewsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex items-stretch gap-px bg-rule border border-rule mb-4 w-fit">
      {TABS.map(tab => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`eyebrow px-3 py-2 whitespace-nowrap transition-colors ${
              active ? 'bg-navy text-white' : 'bg-paper text-ink-mute hover:text-brick'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
