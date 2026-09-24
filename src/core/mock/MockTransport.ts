import { FrameParser } from '../protocol/frame';
import type { Transport, TransportEvents, TransportKind } from '../transport/Transport';
import { TransportError } from '../transport/Transport';
import { MockDevice, type MockDeviceOptions } from './MockDevice';

export interface MockTransportOptions {
  kind?: TransportKind;
  /** Simulasi latensi I/O per frame, ms. */
  latencyMs?: number;
  /** Kirim telemetry attitude unsolicited berkala selagi konek. 0 = mati. */
  telemetryIntervalMs?: number;
  device?: MockDeviceOptions;
}

/**
 * core/mock/MockTransport.ts
 * Mengimplementasikan interface Transport yang sama persis dengan
 * WebUSBTransport/WebSerialTransport (architecture Bagian 14), tapi
 * mensimulasikan device virtual di dalam browser. core/device dan
 * features/* tidak perlu tahu ini bukan device asli.
 */
export class MockTransport implements Transport {
  readonly kind: TransportKind;
  readonly device: MockDevice;

  private connected = false;
  private events: Partial<TransportEvents> = {};
  private parser = new FrameParser();
  private telemetryHandle: ReturnType<typeof setInterval> | null = null;
  private latencyMs: number;
  private telemetryIntervalMs: number;

  constructor(opts: MockTransportOptions = {}) {
    this.kind = opts.kind ?? 'webserial';
    this.latencyMs = opts.latencyMs ?? 15;
    this.telemetryIntervalMs = opts.telemetryIntervalMs ?? 0;
    this.device = new MockDevice(opts.device);

    this.parser.onFrame((frame) => {
      const responses = this.device.handleRequest(frame);
      for (const res of responses) {
        setTimeout(() => this.events.onData?.(res), this.latencyMs);
      }
    });
    // Frame korup tidak realistis muncul dari sisi mock (kita yang encode
    // sendiri), tapi tetap disambungkan untuk konsistensi kontrak.
    this.parser.onFrameError(() => {
      /* no-op */
    });
  }

  async requestDevice(): Promise<void> {
    // Tidak ada picker sungguhan — mock selalu "berhasil dipilih".
  }

  async connect(): Promise<void> {
    this.connected = true;
    if (this.telemetryIntervalMs > 0) {
      this.telemetryHandle = setInterval(() => {
        this.events.onData?.(this.device.encodeUnsolicitedAttitude());
      }, this.telemetryIntervalMs);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.telemetryHandle) {
      clearInterval(this.telemetryHandle);
      this.telemetryHandle = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.connected) {
      throw new TransportError('no-device', 'MockTransport belum connect()');
    }
    this.parser.feed(data);
  }

  setEventHandlers(events: Partial<TransportEvents>): void {
    this.events = { ...this.events, ...events };
  }
}
