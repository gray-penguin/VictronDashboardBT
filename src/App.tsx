import { Bluetooth } from 'lucide-react';

const hasWebBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export default function App() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line px-6 py-4 flex items-center gap-2">
        <Bluetooth className="text-orange-500" size={20} />
        <span className="font-semibold">VictronDashboardBT</span>
      </header>

      <main className="p-6">
        {hasWebBluetooth ? (
          <p className="text-ink-4 text-sm">
            Web Bluetooth is available in this browser. Device scanning isn't wired up yet.
          </p>
        ) : (
          <p className="text-ink-4 text-sm">
            Web Bluetooth isn't available in this browser. Open this page in Chrome on Android or desktop.
          </p>
        )}
      </main>
    </div>
  );
}
