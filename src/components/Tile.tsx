import { ReactNode, useState } from 'react';
import { Info } from 'lucide-react';

interface TileProps {
  icon: ReactNode;
  label: string;
  value: string;
  valueAside?: string;
  sublabel?: string;
  // A second line below sublabel, for tiles that need two distinct rows of
  // detail (e.g. V/A on one line, kWh + a derived % on the next).
  sublabel2?: string;
  badge?: string;
  accent?: 'default' | 'orange';
  // Explanatory text shown in a small popover when the info icon is clicked
  // — for a figure whose meaning isn't obvious from the number alone (e.g.
  // "this is a theoretical ceiling, not a forecast").
  info?: string;
  // A small stacked column of closely-related figures (e.g. Min/Avg/Max),
  // shown on the tile's right edge alongside the main value — for a tile
  // that has one headline number but a few companion ones worth surfacing
  // without their own card. Takes over the badge's spot; pass one or the
  // other, not both.
  stats?: { label: string; value: string }[];
}

export default function Tile({
  icon,
  label,
  value,
  valueAside,
  sublabel,
  sublabel2,
  badge,
  accent = 'default',
  info,
  stats,
}: TileProps) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="bg-surface border border-line rounded-2xl p-5 relative h-full">
      <div className="flex items-center gap-2 text-ink-4 text-xs font-medium mb-3">
        <span className={accent === 'orange' ? 'text-orange-500' : 'text-ink-5'}>{icon}</span>
        {label}
        {info && (
          <button
            type="button"
            onClick={() => setShowInfo((s) => !s)}
            onBlur={() => setShowInfo(false)}
            aria-label="More info"
            className="text-ink-6 hover:text-ink-3 transition-colors"
          >
            <Info size={13} />
          </button>
        )}
        {badge && !stats && <span className="ml-auto text-ink-5 tabular-nums">{badge}</span>}
      </div>
      {showInfo && info && (
        <div className="absolute z-20 top-9 left-3 right-3 bg-surface-2 border border-line-2 rounded-lg p-2.5 text-xs text-ink-3 shadow-lg leading-snug">
          {info}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-ink leading-none">{value}</span>
            {valueAside && <span className="text-sm text-ink-4 leading-none">{valueAside}</span>}
          </div>
          {sublabel && <div className="text-xs text-ink-5 mt-2">{sublabel}</div>}
          {sublabel2 && <div className="text-xs text-ink-5 mt-1">{sublabel2}</div>}
        </div>
        {stats && stats.length > 0 && (
          <div className="shrink-0 text-right space-y-0.5 pt-1">
            {stats.map((s) => (
              <div key={s.label} className="text-xs whitespace-nowrap">
                <span className="text-ink-6">{s.label} </span>
                <span className="text-ink-3 tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
