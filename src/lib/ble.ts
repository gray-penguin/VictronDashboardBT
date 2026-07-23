// Victron's Bluetooth SIG-registered manufacturer company ID. Every Instant
// Readout advertisement (from a shunt, MPPT, DC-DC charger, etc.) carries
// its payload under this key in the advertisement's manufacturer data map.
export const VICTRON_COMPANY_ID = 0x02e1;

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

// Opens the browser's native device picker, filtered to Victron devices.
// One-time per device — the resulting permission persists across reloads,
// so this only needs to run once when a device is first added.
export async function addVictronDevice(): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters: [{ manufacturerData: [{ companyIdentifier: VICTRON_COMPANY_ID }] }],
    // Chrome only forwards manufacturer data for company IDs listed here,
    // even when the same ID was already used in a filter above.
    optionalManufacturerData: [VICTRON_COMPANY_ID],
  });
}

// Reacquires devices the user has already granted permission for, with no
// picker prompt — this is what lets the app come back to a live multi-device
// screen on every reload instead of re-adding devices each time.
// getDevices() isn't implemented in every Chrome build (seen live: absent
// entirely, not just permission-denied, on one desktop build during dev) —
// treat that as "no persisted devices available this session" rather than
// an error, since "Add Device" still works fine per-session either way.
export async function getKnownDevices(): Promise<BluetoothDevice[]> {
  if (typeof navigator.bluetooth.getDevices !== 'function') return [];
  return navigator.bluetooth.getDevices();
}

// Starts listening for this device's advertisements and reports each raw
// Victron payload (manufacturer data, company ID already stripped by the
// browser) as it arrives. Returns an unsubscribe function.
export async function watchVictronAdvertisements(
  device: BluetoothDevice,
  onData: (raw: DataView, device: BluetoothDevice) => void
): Promise<() => void> {
  const handler = (event: BluetoothAdvertisingEvent) => {
    const data = event.manufacturerData.get(VICTRON_COMPANY_ID);
    if (data) onData(data, device);
  };
  device.addEventListener('advertisementreceived', handler as EventListener);
  await device.watchAdvertisements();
  return () => device.removeEventListener('advertisementreceived', handler as EventListener);
}
