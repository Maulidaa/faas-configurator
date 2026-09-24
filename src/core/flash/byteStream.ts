/**
 * core/flash/byteStream.ts
 *
 * Abstraksi byte-stream minimal yang dibutuhkan protokol bootloader serial
 * (stm32Bootloader.ts). Sengaja BUKAN Transport milik DeviceClient: protokol
 * bootloader (AN3155) adalah request/response byte mentah tanpa framing FAAS,
 * jadi tidak bisa lewat DeviceClient/encodeFrame. Memisahkan antarmuka ini
 * juga membuat protokol bisa dites penuh tanpa port serial nyata
 * (lihat __tests__/fakeBootloader.ts).
 */

export type BootloaderErrorKind = 'timeout' | 'nack' | 'protocol' | 'aborted' | 'verify' | 'closed';

export class BootloaderError extends Error {
  kind: BootloaderErrorKind;
  constructor(kind: BootloaderErrorKind, message: string) {
    super(message);
    this.name = 'BootloaderError';
    this.kind = kind;
  }
}

export interface ByteStream {
  write(data: Uint8Array): Promise<void>;
  /**
   * Baca TEPAT n byte. Reject BootloaderError('timeout') kalau belum lengkap
   * dalam timeoutMs, 'aborted' kalau signal di-abort, 'closed' kalau port
   * tertutup/terlepas selagi menunggu. Byte yang sudah masuk tetap di buffer
   * saat timeout — pemanggil yang memutuskan apakah perlu flush().
   */
  read(n: number, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Buang semua byte sisa di buffer penerima. */
  flush(): void;
}

interface Waiter {
  n: number;
  resolve: (data: Uint8Array) => void;
  reject: (err: BootloaderError) => void;
  cleanup: () => void;
}

/**
 * Basis untuk ByteStream berbuffer: subclass cukup memanggil push() tiap ada
 * byte masuk dan fail() bila sumbernya tertutup, serta mengimplementasikan
 * write(). Satu waiter aktif pada satu waktu — protokol ini half-duplex
 * (kirim command, tunggu jawaban), jadi tidak ada baca paralel.
 */
export abstract class BufferedByteStream implements ByteStream {
  private buffer = new Uint8Array(0);
  private waiter: Waiter | null = null;
  private failure: BootloaderError | null = null;

  abstract write(data: Uint8Array): Promise<void>;

  protected push(data: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + data.length);
    merged.set(this.buffer, 0);
    merged.set(data, this.buffer.length);
    this.buffer = merged;
    this.tryResolve();
  }

  protected fail(message: string): void {
    this.failure = new BootloaderError('closed', message);
    if (this.waiter) {
      const w = this.waiter;
      w.cleanup();
      w.reject(this.failure);
    }
  }

  flush(): void {
    this.buffer = new Uint8Array(0);
  }

  read(n: number, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (this.waiter) {
      return Promise.reject(new BootloaderError('protocol', 'read() dipanggil paralel — bug di pemanggil.'));
    }
    if (signal?.aborted) return Promise.reject(new BootloaderError('aborted', 'Dibatalkan.'));
    if (this.buffer.length >= n) return Promise.resolve(this.take(n));
    if (this.failure) return Promise.reject(this.failure);

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new BootloaderError('timeout', `Timeout ${timeoutMs} ms menunggu ${n} byte (diterima ${this.buffer.length}).`),
        );
      }, timeoutMs);
      const onAbort = () => {
        cleanup();
        reject(new BootloaderError('aborted', 'Dibatalkan.'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.waiter = null;
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiter = { n, resolve, reject, cleanup };
    });
  }

  private tryResolve(): void {
    const w = this.waiter;
    if (w && this.buffer.length >= w.n) {
      w.cleanup();
      w.resolve(this.take(w.n));
    }
  }

  private take(n: number): Uint8Array {
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return out;
  }
}
