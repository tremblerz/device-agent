import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type {
  BluetoothConnectionSummary,
  BluetoothPeer,
  BluetoothStartOptions,
} from './types';

type NativeBluetoothModule = {
  start(options: BluetoothStartOptions): Promise<void>;
  stop(): Promise<void>;
  getPeers(): Promise<BluetoothPeer[]>;
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  sendMessage(peerId: string, text: string): Promise<void>;
  isSupported(): Promise<boolean>;
};

const LINKING_ERROR =
  `The native Bluetooth bridge is not available on ${Platform.OS}. ` +
  'Make sure the package is installed and the app has been rebuilt.';

const NativeBluetoothModuleRef = NativeModules.RNDeviceAgentBluetooth ?? null;

const NativeBluetooth: NativeBluetoothModule = NativeBluetoothModuleRef ?? {
  start: async () => {
    throw new Error(LINKING_ERROR);
  },
  stop: async () => {
    throw new Error(LINKING_ERROR);
  },
  getPeers: async () => [],
  connect: async () => {
    throw new Error(LINKING_ERROR);
  },
  disconnect: async () => {
    throw new Error(LINKING_ERROR);
  },
  sendMessage: async () => {
    throw new Error(LINKING_ERROR);
  },
  isSupported: async () => false,
};

type ListenerName =
  | 'peerFound'
  | 'peerLost'
  | 'peerConnected'
  | 'peerDisconnected'
  | 'messageReceived'
  | 'stateChanged'
  | 'error';

export interface NativeBluetoothMessage {
  id: string;
  peerId: string;
  peerName: string | null;
  text: string;
  direction: 'incoming' | 'outgoing';
  timestamp: number;
}

export interface NativeBluetoothPeer extends BluetoothPeer {}

export interface BluetoothBridgeState {
  supported: boolean;
  running: boolean;
}

export class BluetoothBridge {
  private emitter = NativeBluetoothModuleRef ? new NativeEventEmitter(NativeBluetoothModuleRef) : null;

  async isSupported(): Promise<boolean> {
    return NativeBluetooth.isSupported();
  }

  async start(options: BluetoothStartOptions = {}): Promise<void> {
    await NativeBluetooth.start(options);
  }

  async stop(): Promise<void> {
    await NativeBluetooth.stop();
  }

  async getPeers(): Promise<BluetoothPeer[]> {
    return NativeBluetooth.getPeers();
  }

  async connect(peerId: string): Promise<void> {
    await NativeBluetooth.connect(peerId);
  }

  async disconnect(peerId: string): Promise<void> {
    await NativeBluetooth.disconnect(peerId);
  }

  async sendMessage(peerId: string, text: string): Promise<void> {
    await NativeBluetooth.sendMessage(peerId, text);
  }

  addListener<T = any>(
    eventName: ListenerName,
    listener: (event: T) => void,
  ): { remove: () => void } {
    if (!this.emitter) {
      return { remove: () => undefined };
    }
    return this.emitter.addListener(eventName, listener);
  }

  async getState(): Promise<BluetoothBridgeState> {
    return {
      supported: await NativeBluetooth.isSupported(),
      running: false,
    };
  }

  async connectAndReport(peerId: string): Promise<BluetoothConnectionSummary> {
    await this.connect(peerId);
    return { peerId, connected: true };
  }
}

export const bluetoothBridge = new BluetoothBridge();
