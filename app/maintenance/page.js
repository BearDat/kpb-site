import { Wrench } from 'lucide-react';

export const metadata = {
  title: 'Down for maintenance',
};

export default function MaintenancePage() {
  return (
    <main className="min-h-screen bg-paper-well flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-brand flex items-center justify-center">
          <Wrench size={24} className="text-white" />
        </div>
        <h1 className="font-display text-3xl font-extrabold text-ink">Be right back</h1>
        <p className="text-ink-mute">
          KPB is offline for scheduled maintenance. We&apos;ll be back shortly &mdash; thanks for your patience.
        </p>
      </div>
    </main>
  );
}
