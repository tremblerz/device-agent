import { sendText, onTextReceived } from 'expo-nearby-connections';
import { decode, encode, type WireMsg } from './protocol';

/**
 * A bidirectional message channel to the single connected peer. This is the
 * seam: `NearbyChannel` rides MultipeerConnectivity today; any other transport
 * just needs to implement this interface.
 */
export interface Channel {
  send(msg: WireMsg): void;
  onMessage(handler: (msg: WireMsg) => void): () => void;
  close(): void;
}

/** Channel over expo-nearby-connections, bound to one connected peerId. */
export class NearbyChannel implements Channel {
  private unsub: (() => void) | null = null;

  constructor(private peerId: string) {}

  send(msg: WireMsg): void {
    void sendText(this.peerId, encode(msg));
  }

  onMessage(handler: (msg: WireMsg) => void): () => void {
    const sub = onTextReceived(({ peerId, text }) => {
      if (peerId !== this.peerId) return;
      const msg = decode(text);
      if (msg) handler(msg);
    });
    this.unsub = sub;
    return sub;
  }

  close(): void {
    this.unsub?.();
    this.unsub = null;
  }
}
