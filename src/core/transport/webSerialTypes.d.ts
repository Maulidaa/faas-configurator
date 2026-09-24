/**
 * core/transport/webSerialTypes.d.ts
 * Deklarasi ambient minimal untuk Web Serial API — belum tercakup di versi
 * lib.dom TypeScript proyek ini. Hanya mendeklarasikan bagian yang dipakai
 * WebSerialTransport; hapus/gantikan kalau suatu saat @types/w3c-web-serial
 * (atau versi TS yang lebih baru) sudah menyediakannya secara resmi.
 */

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
  addEventListener(type: 'disconnect', listener: (ev: Event) => void): void;
  removeEventListener(type: 'disconnect', listener: (ev: Event) => void): void;
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialRequestOptions {
  filters?: SerialPortFilter[];
}

interface Serial extends EventTarget {
  requestPort(options?: SerialRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial?: Serial;
}
