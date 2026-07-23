import { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth } from 'lucide-react';
import {
  addVictronDevice,
  dataViewToHex,
  getKnownDevices,
  isWebBluetoothSupported,
  watchVictronAdvertisements,
} from './lib/ble';

interface DeviceReading {
  device: BluetoothDevice;
  hex: string;
  byteLength: number;
  count: number;
  lastSeen: number;
}

export default function App() {
  const [supported] = useState(isWebBluetoothSupported());
  const [readings, setReadings] = useState<Record<string, DeviceReading>>({});
  const [error, setError] = useState<string | null>(null);
  // Ref (not state) so effect re-runs — StrictMode's double-invoke included
  // — don't start a second watcher on a device that's already being watched.
  const watching = useRef<Set<string>>(new Set());

  const watch = useCallback(async (device: BluetoothDevice) => {
    if (watching.current.has(device.id)) return;
    watching.current.add(device.id);
    try {
      await watchVictronAdvertisements(device, (raw, dev) => {
        setReadings((prev) => ({
          ...prev,
          [dev.id]: {
            device: dev,
            hex: dataViewToHex(raw),
            byteLength: raw.byteLength,
            count: (prev[dev.id]?.count ?? 0) + 1,
            lastSeen: Date.now(),
          },
        }));
      });
    } catch (err) {
      watching.current.delete(device.id);
      setError(`Failed to watch ${device.name || device.id}: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    if (!supported) return;
    getKnownDevices()
      .then((devices) => devices.forEach(watch))
      .catch((err) => setError((err as Error).message));
  }, [supported, watch]);

  async function handleAddDevice() {
    setError(null);
    try {
      const device = await addVictronDevice();
      await watch(device);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const deviceList = Object.values(readings).sort((a, b) => a.device.id.localeCompare(b.device.id));

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line px-6 py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bluetooth className="text-orange-500" size={20} />
          <span className="font-semibold">VictronDashboardBT</span>
        </div>
        {supported && (
          <button
            onClick={handleAddDevice}
            className="text-sm bg-orange-500 hover:bg-orange-600 text-ink-accent font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            Add Device
          </button>
        )}
      </header>

      <main className="p-6 space-y-4">
        {!supported && (
          <p className="text-ink-4 text-sm">
            Web Bluetooth isn't available in this browser. Open this page in Chrome on desktop or Android.
          </p>
        )}

        {error && (
          <div className="bg-surface border border-line-2 rounded-lg p-3 text-sm text-orange-400">{error}</div>
        )}

        {supported && deviceList.length === 0 && !error && (
          <p className="text-ink-4 text-sm">
            No devices yet. Click "Add Device" and pick a Victron device from the browser's Bluetooth picker.
          </p>
        )}

        {deviceList.map(({ device, hex, byteLength, count, lastSeen }) => (
          <div key={device.id} className="bg-surface border border-line rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink-2">{device.name || 'Unnamed device'}</span>
              <span className="text-xs text-ink-5">
                {count} advertisement{count === 1 ? '' : 's'} &middot; last seen{' '}
                {new Date(lastSeen).toLocaleTimeString()}
              </span>
            </div>
            <div className="mt-2 text-xs text-ink-4 font-mono break-all">
              {byteLength} bytes: {hex}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
