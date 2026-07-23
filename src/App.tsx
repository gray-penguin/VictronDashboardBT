import { useCallback, useEffect, useRef, useState } from 'react';
import { Bluetooth } from 'lucide-react';
import { addVictronDevice, getKnownDevices, isWebBluetoothSupported, watchVictronAdvertisements } from './lib/ble';
import {
  bytesToHex,
  decryptVictronAdvertisement,
  parseBatteryMonitorFields,
  parseDcDcConverterFields,
  parseSolarChargerFields,
  VictronDecryptResult,
} from './lib/victronCrypto';

// Distinguishes report variants once the key-check byte confirms a report
// actually decodes — readout_type alone (0x02 = battery monitor, 0x01 =
// solar charger, 0x04 = DC-DC converter, per the reference library's own
// test fixtures) selects which field layout to apply.
const READOUT_TYPE_BATTERY_MONITOR = 0x02;
const READOUT_TYPE_SOLAR_CHARGER = 0x01;
const READOUT_TYPE_DCDC_CONVERTER = 0x04;

function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

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
  // Separate from `decrypted` (which reflects the LATEST advertisement,
  // even an undecodable one) — this only ever updates on a successful
  // key-check, so the headline reading holds steady through the report
  // types this device sends that aren't decoded yet, instead of blanking
  // out and flashing a "waiting" message every other broadcast.
  const [lastGoodResult, setLastGoodResult] = useState<Record<string, VictronDecryptResult>>({});
  const [decryptError, setDecryptError] = useState<Record<string, string>>({});
  const [lastDecodedAt, setLastDecodedAt] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  // Ref (not state) so effect re-runs — StrictMode's double-invoke included
  // — don't start a second watcher on a device that's already being watched.
  const watching = useRef<Set<string>>(new Set());
  // Guards against out-of-order async resolution: a longer (multi-block)
  // payload's decrypt can take slightly longer than a shorter one issued
  // just after it, so a stale result must not overwrite a newer one.
  const decryptRequestId = useRef<Record<string, number>>({});

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
          if (result.keyCheckOk) {
            setLastGoodResult((prev) => ({ ...prev, [device.id]: result }));
            setLastDecodedAt((prev) => ({ ...prev, [device.id]: Date.now() }));
          }
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
          const decodedAt = lastDecodedAt[device.id];
          const result = decrypted[device.id];
          const goodResult = lastGoodResult[device.id];
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

              <div className="mt-3 flex items-center gap-2">
                <label className="text-xs text-ink-5 shrink-0" htmlFor={`key-${device.id}`}>
                  Encryption key
                </label>
                <input
                  id={`key-${device.id}`}
                  name={`key-${device.id}`}
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  placeholder="paste hex key from VictronConnect"
                  value={keys[device.id] || ''}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [device.id]: e.target.value }))}
                  className="flex-1 min-w-0 bg-surface-2 border border-line-2 rounded-lg px-2 py-1 text-xs font-mono text-ink-3"
                />
              </div>

              {goodResult?.readoutType === READOUT_TYPE_BATTERY_MONITOR &&
                (() => {
                  const fields = parseBatteryMonitorFields(goodResult.plainSkippingCheckByte);
                  return (
                    <div className="mt-3 flex items-baseline gap-6">
                      <div>
                        <div className="text-3xl font-bold text-ink">{fields.voltage.toFixed(2)}V</div>
                      </div>
                      {fields.temperatureC !== undefined && (
                        <div>
                          <div className="text-3xl font-bold text-ink">
                            {celsiusToFahrenheit(fields.temperatureC).toFixed(0)}&deg;F
                          </div>
                        </div>
                      )}
                      <div className="text-sm text-ink-4">
                        {fields.current.toFixed(2)}A &middot; {fields.soc.toFixed(0)}% SOC
                      </div>
                      {decodedAt && (
                        <div className="text-xs text-ink-6 self-end pb-1">
                          updated {new Date(decodedAt).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  );
                })()}
              {goodResult?.readoutType === READOUT_TYPE_SOLAR_CHARGER &&
                (() => {
                  const fields = parseSolarChargerFields(goodResult.plainSkippingCheckByte);
                  return (
                    <div className="mt-3 flex items-baseline gap-6">
                      <div>
                        <div className="text-3xl font-bold text-ink">{fields.solarPowerW}W</div>
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-ink">{(fields.yieldTodayWh / 1000).toFixed(2)}kWh</div>
                        <div className="text-xs text-ink-5">today</div>
                      </div>
                      <div className="text-sm text-ink-4">
                        {fields.voltage.toFixed(2)}V &middot; {fields.current.toFixed(1)}A &middot;{' '}
                        {fields.chargeStateLabel}
                      </div>
                      {decodedAt && (
                        <div className="text-xs text-ink-6 self-end pb-1">
                          updated {new Date(decodedAt).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  );
                })()}
              {goodResult?.readoutType === READOUT_TYPE_DCDC_CONVERTER &&
                (() => {
                  const fields = parseDcDcConverterFields(goodResult.plainSkippingCheckByte);
                  return (
                    <div className="mt-3 flex items-baseline gap-6">
                      <div>
                        <div className="text-3xl font-bold text-ink">
                          {fields.inputVoltage !== undefined ? `${fields.inputVoltage.toFixed(2)}V` : '—'}
                        </div>
                        <div className="text-xs text-ink-5">input</div>
                      </div>
                      <div>
                        <div className="text-3xl font-bold text-ink">
                          {fields.outputVoltage !== undefined ? `${fields.outputVoltage.toFixed(2)}V` : '—'}
                        </div>
                        <div className="text-xs text-ink-5">output</div>
                      </div>
                      <div className="text-sm text-ink-4">{fields.stateLabel}</div>
                      {decodedAt && (
                        <div className="text-xs text-ink-6 self-end pb-1">
                          updated {new Date(decodedAt).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  );
                })()}
              {!goodResult && result && !result.keyCheckOk && (
                <div className="mt-2 text-xs text-ink-6">
                  readout type 0x{result.readoutType.toString(16)} — key doesn't check out for this report variant,
                  waiting for the next broadcast type this device sends
                </div>
              )}
              {decryptError[device.id] && (
                <div className="mt-2 text-xs text-orange-400">{decryptError[device.id]}</div>
              )}

              <details className="mt-3">
                <summary className="text-xs text-ink-6 cursor-pointer select-none">debug info</summary>
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
                      {result.keyFirstByte.toString(16).padStart(2, '0')} ({result.keyCheckOk ? 'match' : 'no match'})
                    </div>
                    <div className="text-xs text-ink-3 font-mono break-all">full: {bytesToHex(result.plainFull)}</div>
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
      </main>
    </div>
  );
}
