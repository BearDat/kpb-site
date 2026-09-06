'use client';

import React from 'react';
import Link from 'next/link';
import Masthead from './Masthead';
import UpdatedStamp from './UpdatedStamp';
import { useLeague } from '../../lib/LeagueContext';
import { EmptyNote } from './primitives';

export default function Shell({ children }) {
  const { snapshot } = useLeague();
  const leagueName = (snapshot && snapshot.name) || 'League';

  return (
    <div className="min-h-screen flex flex-col bg-paper-well">
      <Masthead />
      <main className="flex-1 mx-auto max-w-shell w-full px-4 py-6">
        {snapshot ? children : <EmptyNote>Loading the league…</EmptyNote>}
      </main>
      <footer className="border-t border-rule bg-paper mt-8">
        <div className="mx-auto max-w-shell px-4 py-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <UpdatedStamp leagueName={leagueName} />
            <p className="text-tiny text-ink-faint mt-1">Created by DatBear and Aervial</p>
          </div>
          <Link href="/admin" className="eyebrow text-ink-mute hover:text-brick">
            Admin
          </Link>
        </div>
      </footer>
    </div>
  );
}
