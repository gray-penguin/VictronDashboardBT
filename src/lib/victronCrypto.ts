// Victron's Instant Readout payload format, confirmed against the real,
// widely-used keshavdv/victron-ble Python library's base.py (fetched and
// cross-checked verbatim, not reconstructed from memory) and validated
// against a real captured advertisement from a Smart Battery Sensor.
//
// Layout (after the 2-byte company ID 0x02E1 is already stripped by the
// browser — it's the manufacturerData map key, not part of this payload):
//   bytes 0-1: prefix        (uint16 LE)
//   bytes 2-3: model id       (uint16 LE)
//   byte   4:  readout type   (uint8)
//   bytes 5-6: iv/nonce       (uint16 LE)
//   byte   7:  key-check byte (must equal the real key's first byte)
//   bytes 8+:  AES-128-CTR ciphertext

export interface VictronAdvertisement {
  prefix: number;
  modelId: number;
  readoutType: number;
  iv: number;
  encryptedData: Uint8Array;
}

export class VictronKeyMismatchError extends Error {}

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

// Decrypts one advertisement's payload using the device's per-device key
// (the hex string shown in VictronConnect's Product Info > Instant Readout
// Details > Encryption Data). Throws VictronKeyMismatchError if the key
// doesn't match this device's key-check byte, so callers can tell that
// case apart from a real decoding bug.
export async function decryptVictronAdvertisement(raw: DataView, keyHex: string): Promise<Uint8Array> {
  const adv = parseVictronAdvertisement(raw);
  const keyBytes = hexToBytes(keyHex);

  if (adv.encryptedData.length === 0 || adv.encryptedData[0] !== keyBytes[0]) {
    throw new VictronKeyMismatchError('Encryption key does not match this device');
  }

  // AES-CTR's initial counter block, built to match pycryptodome's
  // Counter.new(128, initial_value=iv, little_endian=True): the iv's own
  // little-endian bytes (as they already appear in the advertisement) go
  // in the low-order position, rest of the 16-byte block is zero. Only
  // block 0 (the initial value, no increment) is ever needed here since
  // Victron payloads are under 16 bytes — so the increment-direction
  // difference between Web Crypto (big-endian) and pycryptodome
  // (little-endian) never actually comes into play.
  const counterBlock = new Uint8Array(16);
  counterBlock[0] = raw.getUint8(5);
  counterBlock[1] = raw.getUint8(6);

  // TS's DOM lib types now require BufferSource's backing buffer to be
  // provably a plain ArrayBuffer (not SharedArrayBuffer) — these are all
  // freshly allocated Uint8Arrays, so the cast is safe at runtime.
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'AES-CTR' }, false, ['decrypt']);
  const ciphertext = adv.encryptedData.slice(1); // drop the key-check byte itself
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-CTR', counter: counterBlock as BufferSource, length: 128 },
    key,
    ciphertext as BufferSource
  );
  return new Uint8Array(plainBuffer);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}
