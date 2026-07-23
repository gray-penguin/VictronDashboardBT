// Victron's Instant Readout payload format, confirmed against the real,
// widely-used keshavdv/victron-ble Python library's base.py (fetched and
// cross-checked verbatim, not reconstructed from memory) and validated
// structurally against real captured advertisements from a Smart Battery
// Sensor: model_id/readout_type read identically across broadcasts (as a
// fixed device identity should) while iv correctly varies each time (as a
// nonce should) — strong evidence this 7-byte header is positioned right.
//
// Layout (after the 2-byte company ID 0x02E1 is already stripped by the
// browser — it's the manufacturerData map key, not part of this payload):
//   bytes 0-1: prefix        (uint16 LE)
//   bytes 2-3: model id       (uint16 LE)
//   byte   4:  readout type   (uint8)
//   bytes 5-6: iv/nonce       (uint16 LE)
//   bytes 7+:  AES-128-CTR ciphertext (the reference library treats byte 7
//              as an extra unencrypted "key-check byte" before the real
//              ciphertext — NOT yet confirmed for this specific model,
//              which isn't in that library's own supported-model table, so
//              both interpretations are decrypted below for comparison).

export interface VictronAdvertisement {
  prefix: number;
  modelId: number;
  readoutType: number;
  iv: number;
  encryptedData: Uint8Array;
}

export interface VictronDecryptResult {
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
