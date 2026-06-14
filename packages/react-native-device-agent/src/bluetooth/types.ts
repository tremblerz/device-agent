export interface BluetoothPeer {
  id: string;
  name: string | null;
  rssi: number | null;
  connected: boolean;
  lastSeenAt: number;
}

export interface BluetoothMessage {
  id: string;
  peerId: string;
  peerName: string | null;
  text: string;
  direction: 'incoming' | 'outgoing';
  timestamp: number;
}

export interface BluetoothStartOptions {
  /** Human-friendly device name shown to peers. Defaults to the OS device name. */
  displayName?: string;
  /** Custom BLE service UUID. Defaults to the built-in device-agent UUID. */
  serviceUuid?: string;
}

export interface BluetoothConnectionSummary {
  peerId: string;
  connected: boolean;
}
