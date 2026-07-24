import { bytesToHex, VictronDecryptResult } from '../lib/victronCrypto';
import { DeviceReading } from '../lib/types';

interface SettingsPageProps {
  supported: boolean;
  error: string | null;
  deviceList: DeviceReading[];
  keys: Record<string, string>;
  onKeyChange: (deviceId: string, value: string) => void;
  onAddDevice: () => void;
  decrypted: Record<string, VictronDecryptResult>;
  lastDecodedAt: Record<string, number>;
}

export default function SettingsPage({
  supported,
  error,
  deviceList,
  keys,
  onKeyChange,
  onAddDevice,
  decrypted,
  lastDecodedAt,
}: SettingsPageProps) {
  return (
    <div className="max-w-2xl space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-ink-2 mb-2">Devices</h2>
        {!supported && (
          <p className="text-ink-4 text-sm mb-3">
            Web Bluetooth isn't available in this browser. Open this page in Chrome on desktop or Android.
          </p>
        )}
        {error && (
          <div className="bg-surface border border-line-2 rounded-lg p-3 text-sm text-orange-400 mb-3">{error}</div>
        )}
        {supported && (
          <button
            onClick={onAddDevice}
            className="text-sm bg-orange-500 hover:bg-orange-600 text-ink-accent font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            Add Device
          </button>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-2 mb-2">Encryption keys</h2>
        <p className="text-xs text-ink-5 mb-3">
          From VictronConnect: open the device &rarr; gear icon &rarr; Product Info &rarr; Instant Readout via
          Bluetooth &rarr; Show, next to Encryption Data.
        </p>
        {deviceList.length === 0 ? (
          <p className="text-ink-4 text-sm">No devices added yet.</p>
        ) : (
          <div className="space-y-3">
            {deviceList.map(({ device, raw, history, count, lastSeen }) => {
              const result = decrypted[device.id];
              const decodedAt = lastDecodedAt[device.id];
              const sameLengthHistory = history.filter((h) => h.length === raw.length);
              const constantMask = Array.from(raw, (_, i) => sameLengthHistory.every((h) => h[i] === raw[i]));
              return (
                <div key={device.id} className="bg-surface border border-line rounded-2xl p-4">
                  <label className="text-xs text-ink-4 block mb-1.5" htmlFor={`key-${device.id}`}>
                    {device.name || 'Unnamed device'}
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
                    onChange={(e) => onKeyChange(device.id, e.target.value)}
                    className="w-full bg-surface-2 border border-line-2 rounded-lg px-2 py-1.5 text-xs font-mono text-ink-3"
                  />

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
                          {result.keyFirstByte.toString(16).padStart(2, '0')} (
                          {result.keyCheckOk ? 'match' : 'no match'})
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
        )}
      </section>
    </div>
  );
}
