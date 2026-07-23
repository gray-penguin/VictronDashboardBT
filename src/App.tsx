import { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth } from 'lucide-react';
import { addVictronDevice, getKnownDevices, isWebBluetoothSupported, watchVictronAdvertisements } from './lib/ble';
import { bytesToHex, decryptVictronAdvertisement, VictronKeyMismatchError } from './lib/victronCrypto';

const KEYS_STORAGE_KEY = 'victron_dashboard_bt_keys';

interface DeviceReading {
  device: BluetoothDevice;
  raw: Uint8Array;
  count: number;
  lastSeen: number;
}

interface DecryptResult {
  hex?: string;
  error?: string;
}

function loadKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function App() {
  const [supported] = useState(isWebBluetoothSupported());
  const [readings, setReadings] = useState<Record<string, DeviceReading>>({});
  const [keys, setKeys] = useState<Record<string, string>>(loadKeys);
  const [decrypted, setDecrypted] = useState<Record<string, DecryptResult>>({});
  const [error, setError] = useState<string | null>(null);
  // Ref (not state) so effect re-runs — StrictMode's double-invoke included
  // — don't start a second watcher on a device that's already being watched.
  const watching = useRef<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  }, [keys]);

  // Re-attempts decryption whenever a fresh advertisement arrives or a key
  // is edited — cheap enough at this device count, and means the decrypted
  // tile updates live as new advertisements come in, not just once.
  useEffect(() => {
    Object.values(readings).forEach(({ device, raw }) => {
      const keyHex = keys[device.id];
      if (!keyHex) return;
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      decryptVictronAdvertisement(view, keyHex)
        .then((plain) => setDecrypted((prev) => ({ ...prev, [device.id]: { hex: bytesToHex(plain) } })))
        .catch((err) => {
          const message = err instanceof VictronKeyMismatchError ? err.message : `Decode error: ${err.message}`;
          setDecrypted((prev) => ({ ...prev, [device.id]: { error: message } }));
        });
    });
  }, [readings, keys]);

  const watch = useCallback(async (device: BluetoothDevice) => {
    if (watching.current.has(device.id)) return;
    watching.current.add(device.id);
    try {
      await watchVictronAdvertisements(device, (raw, dev) => {
        setReadings((prev) => ({
          ...prev,
          [dev.id]: {
            device: dev,
            raw: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice(),
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

        {deviceList.map(({ device, raw, count, lastSeen }) => {
          const result = decrypted[device.id];
          return (
            <div key={device.id} className="bg-surface border border-line rounded-2xl p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-ink-2">{device.name || 'Unnamed device'}</span>
                <span className="text-xs text-ink-5">
                  {count} advertisement{count === 1 ? '' : 's'} &middot; last seen{' '}
                  {new Date(lastSeen).toLocaleTimeString()}
                </span>
              </div>
              <div className="mt-2 text-xs text-ink-4 font-mono break-all">
                {raw.byteLength} bytes: {bytesToHex(raw)}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <label className="text-xs text-ink-5 shrink-0" htmlFor={`key-${device.id}`}>
                  Encryption key
                </label>
                <input
                  id={`key-${device.id}`}
                  type="text"
                  spellCheck={false}
                  placeholder="paste hex key from VictronConnect"
                  value={keys[device.id] || ''}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [device.id]: e.target.value }))}
                  className="flex-1 min-w-0 bg-surface-2 border border-line-2 rounded-lg px-2 py-1 text-xs font-mono text-ink-3"
                />
              </div>

              {result?.hex && (
                <div className="mt-2 text-xs text-ink-3 font-mono break-all">decrypted: {result.hex}</div>
              )}
              {result?.error && <div className="mt-2 text-xs text-orange-400">{result.error}</div>}
            </div>
          );
        })}
      </main>
    </div>
  );
}
