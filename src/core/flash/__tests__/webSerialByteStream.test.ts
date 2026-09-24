import { describe, expect, it } from 'vitest';
import { BootloaderError } from '../byteStream';
import { Stm32Bootloader } from '../stm32Bootloader';
import { WebSerialByteStream } from '../webSerialByteStream';
import { FLASH_BASE, FakeBootloader } from './fakeBootloader';

/**
 * SerialPort palsu berbasis Web Streams: byte yang ditulis host diumpankan
 * ke FakeBootloader, balasan bootloader keluar lewat `readable` — jalur
 * yang sama dengan Web Serial asli, termasuk lock reader/writer.
 */
class FakePort extends FakeBootloader {
  openedWith: SerialOptions | null = null;
  portClosed = false;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor(opts = {}) {
    super(opts);
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => void (this.controller = c) });
    this.writable = new WritableStream<Uint8Array>({ write: (chunk) => this.write(chunk) });
  }

  // balasan bootloader → sisi baca port (bukan buffer internal)
  protected override push(data: Uint8Array): void {
    this.controller.enqueue(data);
  }

  async open(options: SerialOptions): Promise<void> {
    this.openedWith = options;
  }

  async close(): Promise<void> {
    // Web Serial asli menolak close() selagi stream masih terkunci.
    if (this.readable.locked || this.writable.locked) throw new Error('stream masih terkunci');
    this.portClosed = true;
  }

  /** Simulasi kabel dicabut. */
  unplug(): void {
    this.controller.error(new Error('device lost'));
  }
}

const asPort = (p: FakePort) => p as unknown as SerialPort;

describe('WebSerialByteStream', () => {
  it('membuka port 8E1 dan menjalankan flashing penuh lewat stream nyata', async () => {
    const port = new FakePort();
    const stream = await WebSerialByteStream.open(asPort(port), 115200);
    expect(port.openedWith).toMatchObject({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'even' });

    const image = new Uint8Array(700).map((_, i) => (i * 7) & 0xfe);
    const bl = new Stm32Bootloader(stream, { ackMs: 500, initRetryMs: 100 });
    const res = await bl.flash({ segments: [{ address: FLASH_BASE, data: image }], goAddress: FLASH_BASE });

    expect(res.started).toBe(true);
    expect(Array.from(port.flash.subarray(0, 700))).toEqual(Array.from(image));

    await stream.close();
    expect(port.portClosed).toBe(true); // lock terlepas dengan benar → port.close() tidak ditolak
  });

  it('read() timeout tidak meninggalkan pembacaan menggantung — read berikutnya tetap jalan', async () => {
    const port = new FakePort({ ignoreInitCount: 1 });
    const stream = await WebSerialByteStream.open(asPort(port), 115200);
    await expect(stream.read(1, 30)).rejects.toMatchObject({ kind: 'timeout' });
    await stream.write(Uint8Array.of(0x7f)); // diabaikan (ignoreInitCount)
    await expect(stream.read(1, 30)).rejects.toMatchObject({ kind: 'timeout' });
    await stream.write(Uint8Array.of(0x7f)); // kali ini dijawab ACK
    expect(Array.from(await stream.read(1, 200))).toEqual([0x79]);
    await stream.close();
  });

  it('kabel dicabut saat menunggu → BootloaderError closed, bukan menggantung', async () => {
    const port = new FakePort();
    const stream = await WebSerialByteStream.open(asPort(port), 115200);
    const pending = stream.read(1, 2000);
    port.unplug();
    const err = await pending.then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(BootloaderError);
    expect(err.kind).toBe('closed');
    await stream.close(); // tidak boleh melempar walau stream sudah error
  });
});
