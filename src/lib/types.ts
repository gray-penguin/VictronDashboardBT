export interface DeviceReading {
  device: BluetoothDevice;
  raw: Uint8Array;
  history: Uint8Array[]; // newest first, capped — for spotting which byte
  // positions are truly constant vs. genuinely encrypted across many real
  // broadcasts, rather than guessing from one or two samples.
  count: number;
  lastSeen: number;
}
