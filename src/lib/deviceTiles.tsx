import { ReactNode } from 'react';
import { Battery, Gauge, Sun, Zap } from 'lucide-react';
import {
  parseBatteryMonitorFields,
  parseDcDcConverterFields,
  parseDcEnergyMeterFields,
  parseSolarChargerFields,
} from './victronCrypto';

export const READOUT_TYPE_SOLAR_CHARGER = 0x01;
export const READOUT_TYPE_BATTERY_MONITOR = 0x02;
export const READOUT_TYPE_DCDC_CONVERTER = 0x04;
export const READOUT_TYPE_DC_ENERGY_METER = 0x0d;
export const KNOWN_READOUT_TYPES = [
  READOUT_TYPE_SOLAR_CHARGER,
  READOUT_TYPE_BATTERY_MONITOR,
  READOUT_TYPE_DCDC_CONVERTER,
  READOUT_TYPE_DC_ENERGY_METER,
];

function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export interface TileContent {
  icon: ReactNode;
  value: string;
  valueAside?: string;
  sublabel?: string;
  sublabel2?: string;
  badge?: string;
  stats?: { label: string; value: string }[];
}

// Maps a decoded advertisement to Tile.tsx props, one branch per known
// readout_type — the field parsing itself lives in victronCrypto.ts, this
// only decides how to DISPLAY already-decoded fields. Returns null for a
// readout_type with no parser yet (caller falls back to its own message).
export function buildTileContent(readoutType: number, plain: Uint8Array): TileContent | null {
  switch (readoutType) {
    case READOUT_TYPE_BATTERY_MONITOR: {
      const f = parseBatteryMonitorFields(plain);
      return {
        icon: <Battery size={16} />,
        value: `${f.voltage.toFixed(2)}V`,
        badge: f.temperatureC !== undefined ? `${celsiusToFahrenheit(f.temperatureC).toFixed(0)}°F` : undefined,
      };
    }
    case READOUT_TYPE_SOLAR_CHARGER: {
      const f = parseSolarChargerFields(plain);
      return {
        icon: <Sun size={16} />,
        value: `${f.solarPowerW}W`,
        sublabel: `${f.voltage.toFixed(2)}V · ${f.current.toFixed(1)}A`,
        sublabel2: `${(f.yieldTodayWh / 1000).toFixed(2)}kWh today · ${f.chargeStateLabel}`,
      };
    }
    case READOUT_TYPE_DCDC_CONVERTER: {
      const f = parseDcDcConverterFields(plain);
      return {
        icon: <Zap size={16} />,
        value: f.outputVoltage !== undefined ? `${f.outputVoltage.toFixed(2)}V` : '—',
        sublabel: f.stateLabel,
        stats: [{ label: 'In', value: f.inputVoltage !== undefined ? `${f.inputVoltage.toFixed(2)}V` : '—' }],
      };
    }
    case READOUT_TYPE_DC_ENERGY_METER: {
      const f = parseDcEnergyMeterFields(plain);
      return {
        icon: <Gauge size={16} />,
        value: `${f.current.toFixed(2)}A`,
        sublabel: `${f.voltage.toFixed(2)}V`,
        sublabel2: f.temperatureC !== undefined ? `${celsiusToFahrenheit(f.temperatureC).toFixed(0)}°F` : undefined,
      };
    }
    default:
      return null;
  }
}

// Flat numeric fields worth banking to history, per readout_type — separate
// from TileContent (display strings) since history needs raw numbers, not
// formatted text. Keeps historyStore.ts generic across all device kinds.
export function extractHistoryFields(readoutType: number, plain: Uint8Array): Record<string, number> | null {
  switch (readoutType) {
    case READOUT_TYPE_BATTERY_MONITOR: {
      const f = parseBatteryMonitorFields(plain);
      const fields: Record<string, number> = { voltage: f.voltage };
      if (f.temperatureC !== undefined) fields.temperatureC = f.temperatureC;
      return fields;
    }
    case READOUT_TYPE_SOLAR_CHARGER: {
      const f = parseSolarChargerFields(plain);
      return {
        voltage: f.voltage,
        current: f.current,
        solarPowerW: f.solarPowerW,
        yieldTodayWh: f.yieldTodayWh,
        chargeState: f.chargeState,
      };
    }
    case READOUT_TYPE_DCDC_CONVERTER: {
      const f = parseDcDcConverterFields(plain);
      const fields: Record<string, number> = {};
      if (f.inputVoltage !== undefined) fields.inputVoltage = f.inputVoltage;
      if (f.outputVoltage !== undefined) fields.outputVoltage = f.outputVoltage;
      return fields;
    }
    case READOUT_TYPE_DC_ENERGY_METER: {
      const f = parseDcEnergyMeterFields(plain);
      const fields: Record<string, number> = { voltage: f.voltage, current: f.current };
      if (f.temperatureC !== undefined) fields.temperatureC = f.temperatureC;
      return fields;
    }
    default:
      return null;
  }
}
