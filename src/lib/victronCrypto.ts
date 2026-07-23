// Victron's Instant Readout payload format, confirmed against the real,
// widely-used keshavdv/victron-ble Python library's base.py (fetched and
// cross-checked verbatim, not reconstructed from memory) and validated
// end-to-end against real captured advertisements from a Smart Battery
// Sensor: decrypted voltage/temperature matched VictronConnect's own live
// reading almost exactly (13.45V / 97°F vs. ~13.46-13.50V / 95°F).
//
// Layout (after the 2-byte company ID 0x02E1 is already stripped by the
// browser — it's the manufacturerData map key, not part of this payload):
//   bytes 0-1: prefix        (uint16 LE)
//   bytes 2-3: model id       (uint16 LE)
//   byte   4:  readout type   (uint8)
//   bytes 5-6: iv/nonce       (uint16 LE)
//   byte   7:  key-check byte (must equal the real key's first byte)
//   bytes 8+:  AES-128-CTR ciphertext
//
// IMPORTANT device-specific discovery: this Smart Battery Sensor broadcasts
// MULTIPLE distinct report types in rotation, distinguished by readout_type
// and total length — a 23-byte "battery monitor" style report (readout_type
// 0x02, matches the reference library's own tested format) whose key-check
// byte correctly matches this device's key, interleaved with 16/27-byte
// reports (readout_type 0x59) whose key-check byte never matches and whose
// structure is NOT yet understood. Only the 0x02 report is decoded below —
// gate on keyCheckOk before trusting a result.

export interface VictronAdvertisement {
  prefix: number;
  modelId: number;
  readoutType: number;
  iv: number;
  encryptedData: Uint8Array;
}

export interface VictronDecryptResult {
  readoutType: number;
  keyCheckByte: number;
  keyFirstByte: number;
  keyCheckOk: boolean;
  // Decrypted treating ALL of encryptedData as ciphertext (no byte dropped).
  plainFull: Uint8Array;
  // Decrypted per the reference library's convention: byte 0 of
  // encryptedData is an unencrypted key-check byte, real ciphertext starts
  // at byte 1.
  plainSkippingCheckByte: Uint8Array;
}

export interface BatteryMonitorFields {
  remainingMins: number;
  voltage: number; // volts
  alarm: number;
  auxMode: number; // 0 = starter voltage, 1 = midpoint voltage, 2 = temperature
  starterVoltage?: number;
  midpointVoltage?: number;
  temperatureC?: number;
}

// Field layout confirmed against the reference library's battery_monitor.py
// (voltage/temperature values matched this device's real VictronConnect
// reading almost exactly). The first 8 bytes are byte-aligned; aux_mode is
// the low 2 bits of byte 8 (bit-packed fields beyond it — current,
// consumed_ah, soc — aren't decoded here since this device never reports
// them, having no current-sensing hardware).
export function parseBatteryMonitorFields(plain: Uint8Array): BatteryMonitorFields {
  const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const remainingMins = dv.getUint16(0, true);
  const voltage = dv.getInt16(2, true) / 100;
  const alarm = dv.getUint16(4, true);
  const auxRaw = dv.getUint16(6, true);
  const auxMode = plain[8] & 0b11;

  const fields: BatteryMonitorFields = { remainingMins, voltage, alarm, auxMode };
  if (auxMode === 0) {
    fields.starterVoltage = (auxRaw > 0x7fff ? auxRaw - 0x10000 : auxRaw) / 100;
  } else if (auxMode === 1) {
    fields.midpointVoltage = auxRaw / 100;
  } else if (auxMode === 2) {
    fields.temperatureC = auxRaw / 100 - 273.15;
  }
  return fields;
}

export interface SolarChargerFields {
  chargeState: number;
  chargeStateLabel: string;
  voltage: number; // battery volts
  current: number; // battery charging amps
  solarPowerW: number;
  yieldTodayWh: number;
}

const CHARGE_STATE_LABELS: Record<number, string> = {
  0: 'Off',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
};

// Field layout re-derived empirically against a real capture (readout_type
// 0x01 matches the reference library's test_solar_charger.py type, and its
// documented offsets — read_unsigned_int(8) for charge_state — produced
// implausible values here, e.g. 171V/3123A; shifting every field 8 bits
// later matched real known-plausible readings exactly: 13.47V/12.2A/68W/
// 1.69kWh during active solar charging). Load current (9 bits, packed)
// isn't decoded — not needed and this device likely has nothing wired to it.
export function parseSolarChargerFields(plain: Uint8Array): SolarChargerFields {
  const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const chargeState = dv.getUint16(0, true);
  const voltage = dv.getInt16(2, true) / 100;
  const current = dv.getInt16(4, true) / 10;
  const solarPowerW = dv.getUint16(6, true);
  const yieldTodayWh = dv.getUint16(8, true) * 10;
  return {
    chargeState,
    chargeStateLabel: CHARGE_STATE_LABELS[chargeState] ?? `unknown (${chargeState})`,
    voltage,
    current,
    solarPowerW,
    yieldTodayWh,
  };
}

export interface DcDcConverterFields {
  state: number | undefined; // undefined = sentinel "no data" (0xff)
  stateLabel: string;
  error: number | undefined;
  inputVoltage: number | undefined; // volts
  outputVoltage: number | undefined; // volts
}

const DEVICE_STATE_LABELS: Record<number, string> = {
  0: 'Off',
  3: 'Bulk',
  4: 'Absorption',
  5: 'Float',
};

// Field layout confirmed against the reference library's own test fixture
// (test_dcdc_converter.py) BEFORE trusting it against real hardware — unlike
// solar_charger.py, this one's documented offsets matched the fixture's
// expected values exactly (state=Off, error=none, input=13.15V, output=the
// documented "no data" sentinel), so no empirical re-derivation was needed
// here. readout_type for this device family is 0x04 (WebFetch's initial
// summary of the raw hex mis-reported this as 0xc0 — that's actually the
// byte at offset 2, part of model_id; always recount raw hex by hand rather
// than trust a summarized offset claim).
export function parseDcDcConverterFields(plain: Uint8Array): DcDcConverterFields {
  const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const stateRaw = plain[0];
  const errorRaw = plain[1];
  const inputRaw = dv.getUint16(2, true);
  const outputRaw = dv.getInt16(4, true);

  const state = stateRaw === 0xff ? undefined : stateRaw;
  return {
    state,
    stateLabel: state === undefined ? 'N/A' : (DEVICE_STATE_LABELS[state] ?? `unknown (${state})`),
    error: errorRaw === 0xff ? undefined : errorRaw,
    inputVoltage: inputRaw === 0xffff ? undefined : inputRaw / 100,
    outputVoltage: outputRaw === 0x7fff ? undefined : outputRaw / 100,
  };
}

export function parseVictronAdvertisement(raw: DataView): VictronAdvertisement {
  return {
    prefix: raw.getUint16(0, true),
    modelId: raw.getUint16(2, true),
    readoutType: raw.getUint8(4),
    iv: raw.getUint16(5, true),
    encryptedData: new Uint8Array(raw.buffer, raw.byteOffset + 7, raw.byteLength - 7),
  };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/\s+/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Builds the Nth 16-byte AES-CTR counter block to match pycryptodome's
// Counter.new(128, initial_value=iv, little_endian=True): a 128-bit
// little-endian integer starting at `iv`, incrementing by 1 per block.
// Web Crypto's own built-in counter increment is big-endian, which would
// silently produce the wrong keystream for any block after the first —
// so each block is decrypted with its own explicit starting value here,
// rather than handing Web Crypto more than 16 bytes in one call.
function counterBlockLE(iv: number, blockIndex: number): Uint8Array {
  let value = iv + blockIndex;
  const block = new Uint8Array(16);
  for (let i = 0; i < 16 && value > 0; i++) {
    block[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return block;
}

async function ctrDecrypt(key: CryptoKey, iv: number, ciphertext: Uint8Array): Promise<Uint8Array> {
  const blockSize = 16;
  const out = new Uint8Array(ciphertext.length);
  for (let offset = 0; offset < ciphertext.length; offset += blockSize) {
    const chunk = ciphertext.slice(offset, offset + blockSize);
    const counter = counterBlockLE(iv, offset / blockSize);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: counter as BufferSource, length: 128 },
      key,
      chunk as BufferSource
    );
    out.set(new Uint8Array(plainBuf), offset);
  }
  return out;
}

// Decrypts one advertisement's payload using the device's per-device key
// (the hex string shown in VictronConnect's Product Info > Instant Readout
// Details > Encryption Data). Returns both candidate interpretations plus
// the key-check result, rather than hard-failing on mismatch — useful
// while confirming the exact envelope for a model the reference library
// doesn't itself list.
export async function decryptVictronAdvertisement(raw: DataView, keyHex: string): Promise<VictronDecryptResult> {
  const adv = parseVictronAdvertisement(raw);
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'AES-CTR' }, false, ['decrypt']);

  const keyCheckByte = adv.encryptedData[0];
  const keyFirstByte = keyBytes[0];

  const [plainFull, plainSkippingCheckByte] = await Promise.all([
    ctrDecrypt(key, adv.iv, adv.encryptedData),
    ctrDecrypt(key, adv.iv, adv.encryptedData.slice(1)),
  ]);

  return {
    readoutType: adv.readoutType,
    keyCheckByte,
    keyFirstByte,
    keyCheckOk: keyCheckByte === keyFirstByte,
    plainFull,
    plainSkippingCheckByte,
  };
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}
