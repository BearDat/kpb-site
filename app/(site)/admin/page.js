'use client';

import React from 'react';
import { AuthProvider, useAuth } from '../../../lib/AuthContext';
import { AdminLeagueProvider } from '../../../lib/AdminLeagueContext';
import { usePageTitle } from '../../../lib/LeagueContext';
import AdminShell from '../../../components/admin/AdminShell';
import QueuePanel from '../../../components/admin/QueuePanel';
import ScoresPanel from '../../../components/admin/ScoresPanel';
import AwardsPanel from '../../../components/admin/AwardsPanel';
import StatsPanel from '../../../components/admin/StatsPanel';
import NewsPanel from '../../../components/admin/NewsPanel';
import HighlightsPanel from '../../../components/admin/HighlightsPanel';
import RosterPanel from '../../../components/admin/RosterPanel';
import SeasonPanel from '../../../components/admin/SeasonPanel';
import AdminsPanel from '../../../components/admin/AdminsPanel';

function Panels() {
  const { hasPermission } = useAuth();
  const tabs = [
    { key: 'queue', label: 'Bot queue', perm: 'manageRosterMoves', allowed: hasPermission('manageRosterMoves'), render: () => <QueuePanel /> },
    { key: 'scores', label: 'Scores', perm: 'manageSchedule', allowed: hasPermission('manageSchedule'), render: () => <ScoresPanel /> },
    { key: 'awards', label: 'Awards', perm: 'manageAwards', allowed: hasPermission('manageAwards'), render: () => <AwardsPanel /> },
    { key: 'stats', label: 'Stats', perm: 'manageSchedule', allowed: hasPermission('manageSchedule'), render: () => <StatsPanel /> },
    { key: 'news', label: 'News', perm: 'manageNews', allowed: hasPermission('manageNews'), render: () => <NewsPanel /> },
    { key: 'highlights', label: 'Highlights', perm: 'manageNews', allowed: hasPermission('manageNews'), render: () => <HighlightsPanel /> },
    { key: 'roster', label: 'Roster', perm: 'manageRosterMoves', allowed: hasPermission('manageRosterMoves'), render: () => <RosterPanel /> },
    { key: 'season', label: 'Season', perm: 'manageSeasons', allowed: hasPermission('manageSeasons'), render: () => <SeasonPanel /> },
    { key: 'admins', label: 'Admins', perm: 'manageAdmins', allowed: hasPermission('manageAdmins'), render: () => <AdminsPanel /> },
  ];
  return <AdminShell tabs={tabs} />;
}

export default function AdminPage() {
  usePageTitle('Admin');
  return (
    <AuthProvider>
      <AdminLeagueProvider>
        <Panels />
      </AdminLeagueProvider>
    </AuthProvider>
  );
}
