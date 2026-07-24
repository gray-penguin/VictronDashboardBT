import { useState } from 'react';
import { X } from 'lucide-react';
import { VictronDecryptResult } from '../lib/victronCrypto';
import { buildTileContent } from '../lib/deviceTiles';
import { DeviceReading } from '../lib/types';
import { Prefs } from '../lib/storage';
import Tile from '../components/Tile';

interface DashboardPageProps {
  supported: boolean;
  error: string | null;
  deviceList: DeviceReading[];
  decrypted: Record<string, VictronDecryptResult>;
  lastGoodResult: Record<string, VictronDecryptResult>;
  decryptError: Record<string, string>;
  prefs: Prefs;
  onPrefsChange: (next: Prefs) => void;
}

export default function DashboardPage({
  supported,
  error,
  deviceList,
  decrypted,
  lastGoodResult,
  decryptError,
  prefs,
  onPrefsChange,
}: DashboardPageProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);

  const byKey = new Map(deviceList.map((d) => [d.device.id, d]));
  const hidden = new Set(prefs.hiddenTiles);
  const orderedKeys = [
    ...prefs.dashboardTileOrder.filter((k) => byKey.has(k)),
    ...deviceList.filter((d) => !prefs.dashboardTileOrder.includes(d.device.id)).map((d) => d.device.id),
  ];
  const visibleKeys = orderedKeys.filter((k) => !hidden.has(k));
  const hiddenDevices = orderedKeys.filter((k) => hidden.has(k)).map((k) => byKey.get(k)!);

  function hideTile(id: string) {
    onPrefsChange({ ...prefs, hiddenTiles: [...prefs.hiddenTiles, id] });
  }

  function showTile(id: string) {
    onPrefsChange({ ...prefs, hiddenTiles: prefs.hiddenTiles.filter((k) => k !== id) });
  }

  function handleDrop(targetId: string) {
    if (!dragKey || dragKey === targetId) return;
    const next = [...orderedKeys];
    const from = next.indexOf(dragKey);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    onPrefsChange({ ...prefs, dashboardTileOrder: next });
    setDragKey(null);
  }

  return (
    <div className="space-y-4">
      {!supported && (
        <p className="text-ink-4 text-sm">
          Web Bluetooth isn't available in this browser. Open this page in Chrome on desktop or Android.
        </p>
      )}

      {error && <div className="bg-surface border border-line-2 rounded-lg p-3 text-sm text-orange-400">{error}</div>}

      {supported && deviceList.length === 0 && !error && (
        <p className="text-ink-4 text-sm">
          No devices yet. Go to Settings to add a Victron device from the browser's Bluetooth picker.
        </p>
      )}

      {deviceList.length > 0 && (
        <p className="text-xs text-ink-6">
          History only accumulates while this page is open — nothing is logged in the background.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleKeys.map((id) => {
          const { device } = byKey.get(id)!;
          const result = decrypted[id];
          const goodResult = lastGoodResult[id];
          const content = goodResult ? buildTileContent(goodResult.readoutType, goodResult.plainSkippingCheckByte) : null;

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
                      readout type 0x{goodResult.readoutType.toString(16)} key-checked OK but has no field parser yet
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

              {decryptError[id] && <div className="mt-2 text-xs text-orange-400">{decryptError[id]}</div>}
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
    </div>
  );
}
