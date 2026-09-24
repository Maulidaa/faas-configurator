import { BufferedByteStream } from './byteStream';

/**
 * core/flash/webSerialByteStream.ts
 *
 * Adapter Web Serial API → ByteStream untuk stm32Bootloader.
 *
 * Kenapa file ini membuka port SENDIRI, bukan memakai transport milik
 * connectionStore: ROM bootloader STM32 butuh paritas even (8E1), sedangkan
 * koneksi FAAS memakai konfigurasi lain. Port yang sama juga tidak bisa
 * dibuka dua kali — kalau user memilih port yang sedang dipakai koneksi
 * FAAS, open() akan gagal (InvalidStateError) dan pesannya diterjemahkan di
 * serialFlashStore jadi "putuskan dulu".
 *
 * Loop baca dijalankan terus di latar (pump) dan menaruh byte ke buffer;
 * read() dengan timeout hidup di BufferedByteStream. Ini menghindari
 * memanggil reader.read() paralel/menggantung saat timeout.
 */

export const SERIAL_BAUD_RATES = [57600, 115200, 230400, 460800, 921600] as const;

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export class WebSerialByteStream extends BufferedByteStream {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private pumpDone: Promise<void>;
  private closing = false;

  private port: SerialPort;

  private constructor(
    port: SerialPort,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    writer: WritableStreamDefaultWriter<Uint8Array>,
  ) {
    super();
    this.port = port;
    this.reader = reader;
    this.writer = writer;
    this.pumpDone = this.pump();
  }

  static async open(port: SerialPort, baudRate: number): Promise<WebSerialByteStream> {
    await port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'even',
      flowControl: 'none',
      bufferSize: 8192,
    });
    if (!port.readable || !port.writable) {
      await port.close().catch(() => {});
      throw new Error('Port serial terbuka tetapi stream baca/tulis tidak tersedia.');
    }
    return new WebSerialByteStream(port, port.readable.getReader(), port.writable.getWriter());
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) this.push(value);
      }
      if (!this.closing) this.fail('Port serial ditutup.');
    } catch (err) {
      if (!this.closing) {
        this.fail(`Port serial terputus: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async write(data: Uint8Array): Promise<void> {
    await this.writer.write(data);
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.reader.cancel();
    } catch {
      /* sudah tertutup */
    }
    await this.pumpDone;
    try {
      this.reader.releaseLock();
      await this.writer.close().catch(() => {});
      this.writer.releaseLock();
    } catch {
      /* lock sudah dilepas */
    }
    try {
      await this.port.close();
    } catch {
      /* port sudah tertutup/terlepas */
    }
  }
}
