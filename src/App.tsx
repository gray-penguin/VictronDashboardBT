import { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth, X } from 'lucide-react';
import { addVictronDevice, getKnownDevices, isWebBluetoothSupported, watchVictronAdvertisements } from './lib/ble';
import { bytesToHex, decryptVictronAdvertisement, VictronDecryptResult } from './lib/victronCrypto';
import { buildTileContent, extractHistoryFields } from './lib/deviceTiles';
import { getPrefs, setPrefs } from './lib/storage';
import { appendReading } from './lib/historyStore';
import Tile from './components/Tile';

const KEYS_STORAGE_KEY = 'victron_dashboard_bt_keys';
const HISTORY_LIMIT = 20;
const HISTORY_BANK_INTERVAL_MS = 60_000;

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
  const [dragKey, setDragKey] = useState<string | null>(null);
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

  // Re-attempts decryption whenever a fresh advertisement arrives or a key
  // is edited — cheap enough at this device count, and means the decrypted
  // tile updates live as new advertisements come in, not just once.
  useEffect(() => {
    Object.values(readings).forEach(({ device, raw }) => {
      const keyHex = keys[device.id];
      if (!keyHex) return;
      const requestId = (decryptRequestId.current[device.id] ?? 0) + 1;
      decryptRequestId.current[device.id] = requestId;
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      decryptVictronAdvertisement(view, keyHex)
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

  const byKey = new Map(deviceList.map((d) => [d.device.id, d]));
  const hidden = new Set(prefs.hiddenTiles);
  const orderedKeys = [
    ...prefs.dashboardTileOrder.filter((k) => byKey.has(k)),
    ...deviceList.filter((d) => !prefs.dashboardTileOrder.includes(d.device.id)).map((d) => d.device.id),
  ];
  const visibleKeys = orderedKeys.filter((k) => !hidden.has(k));
  const hiddenDevices = orderedKeys.filter((k) => hidden.has(k)).map((k) => byKey.get(k)!);

  function persistOrder(orderedIds: string[]) {
    const next = { ...prefs, dashboardTileOrder: orderedIds };
    setPrefs(next);
    setPrefsState(next);
  }

  function hideTile(id: string) {
    const next = { ...prefs, hiddenTiles: [...prefs.hiddenTiles, id] };
    setPrefs(next);
    setPrefsState(next);
  }

  function showTile(id: string) {
    const next = { ...prefs, hiddenTiles: prefs.hiddenTiles.filter((k) => k !== id) };
    setPrefs(next);
    setPrefsState(next);
  }

  function handleDrop(targetId: string) {
    if (!dragKey || dragKey === targetId) return;
    const next = [...orderedKeys];
    const from = next.indexOf(dragKey);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    persistOrder(next);
    setDragKey(null);
  }

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

        {deviceList.length > 0 && (
          <p className="text-xs text-ink-6">
            History only accumulates while this page is open — nothing is logged in the background.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleKeys.map((id) => {
            const { device, raw, history, count, lastSeen } = byKey.get(id)!;
            const decodedAt = lastDecodedAt[id];
            const result = decrypted[id];
            const goodResult = lastGoodResult[id];
            const content = goodResult ? buildTileContent(goodResult.readoutType, goodResult.plainSkippingCheckByte) : null;
            const sameLengthHistory = history.filter((h) => h.length === raw.length);
            const constantMask = Array.from(raw, (_, i) => sameLengthHistory.every((h) => h[i] === raw[i]));

            return (
              <div
                key={id}
                draggable
                onDragStart={() => setDragKey(id)}
                onDragEnd={() => setDragKey(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(id)}
                className={`group relative cursor-grab active:cursor-grabbing transition-opacity ${
                  dragKey === id ? 'opacity-40' : ''
                }`}
              >
                {content ? (
                  <Tile
                    icon={content.icon}
                    label={device.name || 'Unnamed device'}
                    value={content.value}
                    valueAside={content.valueAside}
                    sublabel={content.sublabel}
                    sublabel2={content.sublabel2}
                    badge={content.badge}
                    stats={content.stats}
                    accent="orange"
                  />
                ) : (
                  <div className="bg-surface border border-line rounded-2xl p-5 h-full">
                    <div className="text-xs font-medium text-ink-4 mb-3">{device.name || 'Unnamed device'}</div>
                    {goodResult && (
                      <div className="text-xs text-ink-6">
                        readout type 0x{goodResult.readoutType.toString(16)} key-checked OK but has no field parser
                        yet
                      </div>
                    )}
                    {!goodResult && result && !result.keyCheckOk && (
                      <div className="text-xs text-ink-6">
                        readout type 0x{result.readoutType.toString(16)} — key doesn't check out for this report
                        variant, waiting for the next broadcast type this device sends
                      </div>
                    )}
                    {!goodResult && !result && <div className="text-xs text-ink-6">Waiting for first reading…</div>}
                  </div>
                )}

                <button
                  onClick={() => hideTile(id)}
                  title="Hide tile"
                  className="absolute top-2 right-2 p-1 rounded-lg text-ink-6 opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-ink-3 transition"
                >
                  <X size={14} />
                </button>

                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs text-ink-5 shrink-0" htmlFor={`key-${id}`}>
                    Key
                  </label>
                  <input
                    id={`key-${id}`}
                    name={`key-${id}`}
                    type="text"
                    spellCheck={false}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    placeholder="paste hex key from VictronConnect"
                    value={keys[id] || ''}
                    onChange={(e) => setKeys((prev) => ({ ...prev, [id]: e.target.value }))}
                    className="flex-1 min-w-0 bg-surface-2 border border-line-2 rounded-lg px-2 py-1 text-xs font-mono text-ink-3"
                  />
                </div>

                {decryptError[id] && <div className="mt-2 text-xs text-orange-400">{decryptError[id]}</div>}

                <details className="mt-2">
                  <summary className="text-xs text-ink-6 cursor-pointer select-none">debug info</summary>
                  <div className="mt-2 text-xs text-ink-5">
                    {count} advertisement{count === 1 ? '' : 's'} &middot; last seen{' '}
                    {new Date(lastSeen).toLocaleTimeString()}
                    {decodedAt && <> &middot; last decoded {new Date(decodedAt).toLocaleTimeString()}</>}
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
                  {result && (
                    <div className="mt-2 space-y-1">
                      <div className={`text-xs ${result.keyCheckOk ? 'text-ink-5' : 'text-orange-400'}`}>
                        readout 0x{result.readoutType.toString(16)} &middot; key-check byte: 0x
                        {result.keyCheckByte.toString(16).padStart(2, '0')} vs key[0]: 0x
                        {result.keyFirstByte.toString(16).padStart(2, '0')} ({result.keyCheckOk ? 'match' : 'no match'}
                        )
                      </div>
                      <div className="text-xs text-ink-3 font-mono break-all">
                        full: {bytesToHex(result.plainFull)}
                      </div>
                      <div className="text-xs text-ink-3 font-mono break-all">
                        skip-first-byte: {bytesToHex(result.plainSkippingCheckByte)}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {history.map((h, i) => (
                      <div key={i} className="text-xs text-ink-5 font-mono break-all">
                        {h.length}b: {bytesToHex(h)}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>

        {hiddenDevices.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-6">Hidden:</span>
            {hiddenDevices.map(({ device }) => (
              <button
                key={device.id}
                onClick={() => showTile(device.id)}
                title="Show tile"
                className="px-3 py-1 rounded-full text-xs bg-surface border border-line text-ink-4 hover:text-ink-2 hover:border-line-3 transition-colors"
              >
                + {device.name || 'Unnamed device'}
              </button>
            ))}
          </div>
        )}

        {deviceList.length > 0 && (
          <p className="text-[11px] text-ink-6">Drag tiles to reorder &middot; hover a tile and click ✕ to hide it.</p>
        )}
      </main>
    </div>
  );
}
