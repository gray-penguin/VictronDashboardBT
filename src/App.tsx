import { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth } from 'lucide-react';
import { addVictronDevice, getKnownDevices, isWebBluetoothSupported, watchVictronAdvertisements } from './lib/ble';
import { bytesToHex, decryptVictronAdvertisement, VictronDecryptResult } from './lib/victronCrypto';

const KEYS_STORAGE_KEY = 'victron_dashboard_bt_keys';

const HISTORY_LIMIT = 20;

interface DeviceReading {
  device: BluetoothDevice;
  raw: Uint8Array;
  history: Uint8Array[]; // newest first, capped at HISTORY_LIMIT — for
  // spotting which byte positions are truly constant vs. genuinely
  // encrypted across many real broadcasts, rather than guessing from
  // one or two samples.
  count: number;
  lastSeen: number;
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
  const [decrypted, setDecrypted] = useState<Record<string, VictronDecryptResult>>({});
  const [decryptError, setDecryptError] = useState<Record<string, string>>({});
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
        .then((result) => setDecrypted((prev) => ({ ...prev, [device.id]: result })))
        .catch((err) => setDecryptError((prev) => ({ ...prev, [device.id]: (err as Error).message })));
    });
  }, [readings, keys]);

  const watch = useCallback(async (device: BluetoothDevice) => {
    if (watching.current.has(device.id)) return;
    watching.current.add(device.id);
    try {
      await watchVictronAdvertisements(device, (raw, dev) => {
        const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice();
        setReadings((prev) => {
          const prevHistory = prev[dev.id]?.history ?? [];
          return {
            ...prev,
            [dev.id]: {
              device: dev,
              raw: bytes,
              history: [bytes, ...prevHistory].slice(0, HISTORY_LIMIT),
              count: (prev[dev.id]?.count ?? 0) + 1,
              lastSeen: Date.now(),
            },
          };
        });
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

        {deviceList.map(({ device, raw, history, count, lastSeen }) => {
          const result = decrypted[device.id];
          // A byte position is "constant" if every captured advertisement of
          // the SAME total length agrees on that byte — comparing across
          // different lengths isn't meaningful, since a longer payload likely
          // has extra fields shifting nothing, but different report variants.
          const sameLengthHistory = history.filter((h) => h.length === raw.length);
          const constantMask = Array.from(raw, (_, i) => sameLengthHistory.every((h) => h[i] === raw[i]));
          return (
            <div key={device.id} className="bg-surface border border-line rounded-2xl p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-ink-2">{device.name || 'Unnamed device'}</span>
                <span className="text-xs text-ink-5">
                  {count} advertisement{count === 1 ? '' : 's'} &middot; last seen{' '}
                  {new Date(lastSeen).toLocaleTimeString()}
                </span>
              </div>

              <div className="mt-2 text-xs font-mono break-all">
                {raw.byteLength} bytes:{' '}
                {Array.from(raw).map((b, i) => (
                  <span key={i} className={constantMask[i] ? 'text-orange-400' : 'text-ink-4'}>
                    {b.toString(16).padStart(2, '0')}{' '}
                  </span>
                ))}
                <span className="text-ink-6">
                  (orange = constant across all {sameLengthHistory.length}-sample same-length history)
                </span>
              </div>

              <details className="mt-1">
                <summary className="text-xs text-ink-6 cursor-pointer select-none">
                  show last {history.length} captures
                </summary>
                <div className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                  {history.map((h, i) => (
                    <div key={i} className="text-xs text-ink-5 font-mono break-all">
                      {h.length}b: {bytesToHex(h)}
                    </div>
                  ))}
                </div>
              </details>

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

              {result && (
                <div className="mt-2 space-y-1">
                  <div className={`text-xs ${result.keyCheckOk ? 'text-ink-5' : 'text-orange-400'}`}>
                    key-check byte: 0x{result.keyCheckByte.toString(16).padStart(2, '0')} vs key[0]: 0x
                    {result.keyFirstByte.toString(16).padStart(2, '0')} ({result.keyCheckOk ? 'match' : 'no match'})
                  </div>
                  <div className="text-xs text-ink-3 font-mono break-all">
                    full: {bytesToHex(result.plainFull)}
                  </div>
                  <div className="text-xs text-ink-3 font-mono break-all">
                    skip-first-byte: {bytesToHex(result.plainSkippingCheckByte)}
                  </div>
                </div>
              )}
              {decryptError[device.id] && (
                <div className="mt-2 text-xs text-orange-400">{decryptError[device.id]}</div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}
