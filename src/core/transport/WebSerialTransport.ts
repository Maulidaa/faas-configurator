import type { Transport, TransportEvents, TransportKind } from './Transport';
import { TransportError } from './Transport';
import { DEFAULT_BAUD_RATE } from './constants';

/**
 * core/transport/WebSerialTransport.ts
 * Implementasi Transport nyata untuk mode normal (USB CDC-ACM) lewat Web
 * Serial API — pasangan MockTransport untuk device sungguhan.
 *
 * CATATAN VID:PID (lihat transport/constants.ts): nilai di sana masih
 * placeholder di firmware (protocol.md Bagian 12), jadi requestDevice()
 * SENGAJA tidak memfilter port berdasarkan VID:PID — lihat komentar di
 * requestDevice() di bawah. User selalu memilih port secara manual dari
 * daftar lengkap yang ditampilkan browser.
 */
export class WebSerialTransport implements Transport {
  readonly kind: TransportKind = 'webserial';

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private events: Partial<TransportEvents> = {};
  private connected = false;
  private readLoopAbort = false;
  private readonly handlePortDisconnect = (): void => this.handleDisconnect();

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.serial;
  }

  /**
   * Filter VID:PID sengaja TIDAK dipakai di sini — nilainya masih placeholder
   * di firmware (lihat transport/constants.ts) sehingga requestPort() dengan
   * filter itu selalu gagal duluan dengan dialog "No compatible devices
   * found" sebelum fallback ke picker tanpa filter. Daripada user selalu
   * melihat dialog kosong itu tiap kali connect, langsung panggil
   * requestPort() tanpa filter — user tetap bisa pilih port manapun secara
   * manual.
   */
  async requestDevice(): Promise<void> {
    if (!WebSerialTransport.isSupported()) {
      throw new TransportError(
        'unsupported-browser',
        'Web Serial API tidak tersedia di browser ini — pakai Chrome/Edge versi desktop terbaru.',
      );
    }
    const serial = navigator.serial!;
    this.port = await serial.requestPort();
  }

  async connect(): Promise<void> {
    if (!this.port) {
      throw new TransportError('no-device', 'belum ada port dipilih — panggil requestDevice() dulu');
    }
    try {
      await this.port.open({ baudRate: DEFAULT_BAUD_RATE });
    } catch (err) {
      throw new TransportError(
        'io-error',
        `gagal membuka port serial: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.port.addEventListener('disconnect', this.handlePortDisconnect);
    this.connected = true;
    this.readLoopAbort = false;
    void this.readLoop();
  }

  async disconnect(): Promise<void> {
    this.readLoopAbort = true;
    this.connected = false;
    try {
      await this.reader?.cancel();
    } catch {
      // reader mungkin sudah dalam kondisi rusak (device tercabut) — tujuan
      // kita di sini cuma memastikan read loop berhenti, bukan sukses cancel.
    }
    this.reader = null;
    try {
      await this.writer?.close();
    } catch {
      // idem — writer bisa saja sudah invalid kalau port tercabut fisik.
    }
    this.writer = null;
    this.port?.removeEventListener('disconnect', this.handlePortDisconnect);
    try {
      await this.port?.close();
    } catch {
      // port bisa saja sudah tercabut sebelum close() sempat jalan.
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.port?.writable) {
      throw new TransportError('io-error', 'port belum terbuka untuk menulis');
    }
    if (!this.writer) {
      this.writer = this.port.writable.getWriter();
    }
    try {
      await this.writer.write(data);
    } catch (err) {
      throw new TransportError(
        'io-error',
        `gagal menulis ke port: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  setEventHandlers(events: Partial<TransportEvents>): void {
    this.events = events;
  }

  private async readLoop(): Promise<void> {
    if (!this.port?.readable) {
      this.events.onError?.(new TransportError('io-error', 'port tidak punya stream readable'));
      return;
    }
    this.reader = this.port.readable.getReader();
    try {
      while (!this.readLoopAbort) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) {
          this.events.onData?.(value);
        }
      }
    } catch (err) {
      if (!this.readLoopAbort) {
        this.events.onError?.(
          new TransportError('io-error', `read error: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    } finally {
      try {
        this.reader?.releaseLock();
      } catch {
        // stream bisa saja sudah dalam kondisi error — releaseLock ikut throw, abaikan.
      }
    }
  }

  private handleDisconnect(): void {
    this.connected = false;
    this.events.onDisconnect?.();
  }
}
