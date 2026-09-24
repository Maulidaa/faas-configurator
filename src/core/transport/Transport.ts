/**
 * core/transport/Transport.ts
 * Frozen interface — Tahap 0 (web-configurator-architecture.md Bagian 4.1 & 20).
 *
 * Dua implementasi nyata (WebUSBTransport untuk mode DFU, WebSerialTransport
 * untuk mode normal / CDC) dan satu implementasi palsu (MockTransport, lihat
 * core/mock/) mengimplementasikan interface yang sama ini. Kode di
 * core/device dan features/* tidak boleh tahu transport mana yang aktif.
 */

export type TransportKind = 'webusb-normal' | 'webusb-dfu' | 'webserial';

export interface TransportEvents {
  onData: (chunk: Uint8Array) => void;
  onDisconnect: () => void;
  onError: (err: TransportError) => void;
}

export interface Transport {
  readonly kind: TransportKind;
  /** Memicu device picker native browser (WebUSB/WebSerial). Wajib dipanggil dari user gesture. */
  requestDevice(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  send(data: Uint8Array): Promise<void>;
  setEventHandlers(events: Partial<TransportEvents>): void;
}

export type TransportErrorCode =
  | 'no-device'
  | 'permission-denied'
  | 'io-error'
  | 'unsupported-browser';

export class TransportError extends Error {
  code: TransportErrorCode;
  constructor(code: TransportErrorCode, message: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
}
