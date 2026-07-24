import { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth, LayoutGrid, Settings as SettingsIcon } from 'lucide-react';
import { addVictronDevice, getKnownDevices, isWebBluetoothSupported, watchVictronAdvertisements } from './lib/ble';
import { decryptVictronAdvertisement, VictronDecryptResult } from './lib/victronCrypto';
import { extractHistoryFields } from './lib/deviceTiles';
import { getPrefs, setPrefs, Prefs } from './lib/storage';
import { appendReading } from './lib/historyStore';
import { DeviceReading } from './lib/types';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';

const KEYS_STORAGE_KEY = 'victron_dashboard_bt_keys';
const HISTORY_LIMIT = 20;
const HISTORY_BANK_INTERVAL_MS = 60_000;

type View = 'dashboard' | 'settings';

function loadKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEYS_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [supported] = useState(isWebBluetoothSupported());
  const [readings, setReadings] = useState<Record<string, DeviceReading>>({});
  const [keys, setKeys] = useState<Record<string, string>>(loadKeys);
  const [decrypted, setDecrypted] = useState<Record<string, VictronDecryptResult>>({});
  // Separate from `decrypted` (which reflects the LATEST advertisement,
  // even an undecodable one) — this only ever updates on a successful
  // key-check, so the headline reading holds steady through the report
  // types this device sends that aren't decoded yet, instead of blanking
  // out and flashing a "waiting" message every other broadcast.
  const [lastGoodResult, setLastGoodResult] = useState<Record<string, VictronDecryptResult>>({});
  const [decryptError, setDecryptError] = useState<Record<string, string>>({});
  const [lastDecodedAt, setLastDecodedAt] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState(getPrefs);
  // Ref (not state) so effect re-runs — StrictMode's double-invoke included
  // — don't start a second watcher on a device that's already being watched.
  const watching = useRef<Set<string>>(new Set());
  // Guards against out-of-order async resolution: a longer (multi-block)
  // payload's decrypt can take slightly longer than a shorter one issued
  // just after it, so a stale result must not overwrite a newer one.
  const decryptRequestId = useRef<Record<string, number>>({});
  // Gates history banking to roughly once/minute per device — advertisements
  // arrive every 1-3s, and banking every single one would grow IndexedDB fast
  // for no real benefit at typical dashboard-history granularity.
  const lastBankedAt = useRef<Record<string, number>>({});

  useEffect(() => {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  }, [keys]);

  function handlePrefsChange(next: Prefs) {
    setPrefs(next);
    setPrefsState(next);
  }

  // Re-attempts decryption whenever a fresh advertisement arrives or a key
  // is edited — cheap enough at this device count, and means the decrypted
  // tile updates live as new advertisements come in, not just once.
  useEffect(() => {
    Object.values(readings).forEach(({ device, raw }) => {
      const keyHex = keys[device.id];
      if (!keyHex) return;
      const requestId = (decryptRequestId.current[device.id] ?? 0) + 1;
      decryptRequestId.current[device.id] = requestId;
      const dataView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      decryptVictronAdvertisement(dataView, keyHex)
        .then((result) => {
          if (decryptRequestId.current[device.id] !== requestId) return; // superseded
          setDecrypted((prev) => ({ ...prev, [device.id]: result }));
          if (!result.keyCheckOk) return;
          setLastGoodResult((prev) => ({ ...prev, [device.id]: result }));
          setLastDecodedAt((prev) => ({ ...prev, [device.id]: Date.now() }));

          const now = Date.now();
          const last = lastBankedAt.current[device.id] ?? 0;
          if (now - last < HISTORY_BANK_INTERVAL_MS) return;
          const fields = extractHistoryFields(result.readoutType, result.plainSkippingCheckByte);
          if (!fields) return;
          lastBankedAt.current[device.id] = now;
          appendReading({
            id: `${device.id}:${now}`,
            deviceId: device.id,
            deviceName: device.name || 'Unnamed device',
            readoutType: result.readoutType,
            timestampMs: now,
            fields,
          }).catch((err) => console.warn('Failed to bank reading:', err));
        })
        .catch((err) => {
          if (decryptRequestId.current[device.id] !== requestId) return;
          setDecryptError((prev) => ({ ...prev, [device.id]: (err as Error).message }));
        });
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
        <nav className="flex items-center gap-1">
          <button
            onClick={() => setView('dashboard')}
            title="Dashboard"
            className={`p-2 rounded-lg transition-colors ${
              view === 'dashboard' ? 'bg-surface-2 text-orange-400' : 'text-ink-4 hover:text-ink-2'
            }`}
          >
            <LayoutGrid size={18} />
          </button>
          <button
            onClick={() => setView('settings')}
            title="Settings"
            className={`p-2 rounded-lg transition-colors ${
              view === 'settings' ? 'bg-surface-2 text-orange-400' : 'text-ink-4 hover:text-ink-2'
            }`}
          >
            <SettingsIcon size={18} />
          </button>
        </nav>
      </header>

      <main className="p-6">
        {view === 'dashboard' ? (
          <DashboardPage
            supported={supported}
            error={error}
            deviceList={deviceList}
            decrypted={decrypted}
            lastGoodResult={lastGoodResult}
            decryptError={decryptError}
            lastDecodedAt={lastDecodedAt}
            prefs={prefs}
            onPrefsChange={handlePrefsChange}
          />
        ) : (
          <SettingsPage
            supported={supported}
            error={error}
            deviceList={deviceList}
            keys={keys}
            onKeyChange={(id, value) => setKeys((prev) => ({ ...prev, [id]: value }))}
            onAddDevice={handleAddDevice}
          />
        )}
      </main>
    </div>
  );
}
