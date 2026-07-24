import { DeviceReading } from '../lib/types';

interface SettingsPageProps {
  supported: boolean;
  error: string | null;
  deviceList: DeviceReading[];
  keys: Record<string, string>;
  onKeyChange: (deviceId: string, value: string) => void;
  onAddDevice: () => void;
}

export default function SettingsPage({
  supported,
  error,
  deviceList,
  keys,
  onKeyChange,
  onAddDevice,
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
            {deviceList.map(({ device }) => (
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
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
