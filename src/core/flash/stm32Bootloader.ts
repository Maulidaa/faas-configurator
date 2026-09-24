import { BootloaderError, type ByteStream } from './byteStream';
import type { FirmwareSegment } from './firmwareImage';

/**
 * core/flash/stm32Bootloader.ts
 *
 * Klien protokol bootloader USART bawaan STM32 (ST AN3155) di atas ByteStream.
 * Ini BUKAN protokol FAAS (tidak ada framing/CRC/request_id) dan BUKAN DFU
 * USB — ini alur alternatif untuk flashing lewat port serial biasa
 * (mis. adapter USB-UART) ketika device ada di ROM bootloader.
 *
 * Ringkasan protokol (semua alamat/angka multi-byte big-endian):
 *   - Init     : kirim 0x7F → ACK (0x79). Bila sudah pernah di-init, device
 *                membalas NACK (0x1F) — kita anggap itu OK.
 *   - Command  : kirim [cmd, ~cmd] → ACK.
 *   - Alamat   : 4 byte + XOR-nya (1 byte) → ACK.
 *   - Write    : [N-1, data(N), XOR(N-1 ^ data)] → ACK; N ≤ 256, kelipatan 4.
 *   - Read     : [N-1, ~(N-1)] → ACK, lalu N byte data.
 *   - Erase    : 0x43 (legacy) atau 0x44 (extended) — dipilih dari daftar
 *                command yang dilaporkan device lewat Get.
 * Port harus dibuka 8 data bit, PARITAS EVEN, 1 stop bit (8E1).
 */

const ACK = 0x79;
const NACK = 0x1f;
const INIT_BYTE = 0x7f;

const CMD_GET = 0x00;
const CMD_GET_ID = 0x02;
const CMD_READ_MEMORY = 0x11;
const CMD_GO = 0x21;
const CMD_WRITE_MEMORY = 0x31;
const CMD_ERASE = 0x43;
const CMD_EXTENDED_ERASE = 0x44;

const MAX_CHUNK = 256;

export type FlashPhase = 'init' | 'erase' | 'write' | 'verify' | 'go';

export interface FlashProgress {
  phase: FlashPhase;
  /** Untuk write/verify: byte yang sudah diproses. Untuk fase lain: 0 (mulai) atau total (selesai). */
  done: number;
  total: number;
}

export type EraseMode = 'mass' | { sectors: number[] };

export interface FlashOptions {
  segments: FirmwareSegment[];
  /** 'mass' (default) menghapus SELURUH flash, termasuk area lain yang dipakai di luar firmware (mis. setting tersimpan). */
  eraseMode?: EraseMode;
  /** Baca-ulang dan bandingkan tiap byte setelah menulis. Default true. */
  verify?: boolean;
  /** Alamat vektor aplikasi untuk perintah Go setelah flashing; null = jangan jalankan. */
  goAddress?: number | null;
  onProgress?: (p: FlashProgress) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

export interface FlashResult {
  /** false kalau perintah Go ditolak (mis. read-protection) — firmware tetap sudah tertulis. */
  started: boolean;
}

export interface BootloaderInfo {
  /** Versi bootloader, mis. 0x31 = v3.1. */
  version: number;
  commands: number[];
  /** Product ID chip (mis. 0x0413 = STM32F405/407). */
  productId: number;
}

export interface Stm32BootloaderTimeouts {
  ackMs?: number;
  /** Mass/sector erase bisa lama (puluhan detik di chip flash besar). */
  eraseMs?: number;
  /** Jeda antar percobaan init 0x7F. */
  initRetryMs?: number;
  initAttempts?: number;
}

function xorOf(bytes: ArrayLike<number>): number {
  let x = 0;
  for (let i = 0; i < bytes.length; i++) x ^= bytes[i];
  return x & 0xff;
}

function addressBytes(address: number): Uint8Array {
  const a = new Uint8Array(5);
  a[0] = (address >>> 24) & 0xff;
  a[1] = (address >>> 16) & 0xff;
  a[2] = (address >>> 8) & 0xff;
  a[3] = address & 0xff;
  a[4] = xorOf(a.subarray(0, 4));
  return a;
}

const hex = (n: number, w = 2) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');

export class Stm32Bootloader {
  info: BootloaderInfo | null = null;

  private ackMs: number;
  private eraseMs: number;
  private initRetryMs: number;
  private initAttempts: number;
  private signal?: AbortSignal;
  private log: (line: string) => void = () => {};

  private io: ByteStream;

  constructor(io: ByteStream, timeouts: Stm32BootloaderTimeouts = {}) {
    this.io = io;
    this.ackMs = timeouts.ackMs ?? 2000;
    this.eraseMs = timeouts.eraseMs ?? 120_000;
    this.initRetryMs = timeouts.initRetryMs ?? 500;
    this.initAttempts = timeouts.initAttempts ?? 6;
  }

  // ─── low-level ────────────────────────────────────────────────────────────

  private checkAbort(): void {
    if (this.signal?.aborted) throw new BootloaderError('aborted', 'Dibatalkan.');
  }

  private async waitAck(timeoutMs = this.ackMs, context = ''): Promise<void> {
    const [b] = await this.io.read(1, timeoutMs, this.signal);
    if (b === ACK) return;
    if (b === NACK) throw new BootloaderError('nack', `Device menolak (NACK)${context ? ' — ' + context : ''}.`);
    throw new BootloaderError('protocol', `Byte tak terduga ${hex(b)} (diharapkan ACK 0x79)${context ? ' — ' + context : ''}.`);
  }

  private async sendCommand(cmd: number, timeoutMs = this.ackMs): Promise<void> {
    this.checkAbort();
    await this.io.write(Uint8Array.of(cmd, cmd ^ 0xff));
    await this.waitAck(timeoutMs, `command ${hex(cmd)}`);
  }

  private async sendAddress(address: number): Promise<void> {
    await this.io.write(addressBytes(address));
    await this.waitAck(this.ackMs, `alamat ${hex(address, 8)}`);
  }

  // ─── connect / info ───────────────────────────────────────────────────────

  /**
   * Init autobaud + baca Get & Get ID. Dicoba beberapa kali karena user
   * biasanya baru mereset board ke bootloader beberapa saat setelah klik.
   */
  async connect(): Promise<BootloaderInfo> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.initAttempts; attempt++) {
      this.checkAbort();
      this.io.flush();
      try {
        await this.io.write(Uint8Array.of(INIT_BYTE));
        await this.waitAck(this.initRetryMs, 'init');
        lastErr = null;
        break;
      } catch (err) {
        if (err instanceof BootloaderError && err.kind === 'nack') {
          // Sudah di-init sebelumnya (mis. sesi flashing sebelumnya belum di-reset) — sesuai AN3155 itu wajar.
          this.log?.('Bootloader sudah aktif (NACK pada init) — dilanjutkan.');
          lastErr = null;
          break;
        }
        if (err instanceof BootloaderError && err.kind === 'aborted') throw err;
        lastErr = err;
        this.log?.(`Init percobaan ${attempt}/${this.initAttempts} tidak dibalas…`);
      }
    }
    if (lastErr) {
      throw new BootloaderError(
        'timeout',
        'Bootloader tidak menjawab. Pastikan BOOT0 high saat reset, TX/RX tidak tertukar, dan port yang dipilih adalah adapter UART (bukan port USB native board).',
      );
    }

    // Get
    await this.sendCommand(CMD_GET);
    const [n] = await this.io.read(1, this.ackMs, this.signal);
    const body = await this.io.read(n + 1, this.ackMs, this.signal);
    await this.waitAck(this.ackMs, 'akhir Get');
    const version = body[0];
    const commands = Array.from(body.subarray(1));

    // Get ID
    await this.sendCommand(CMD_GET_ID);
    const [m] = await this.io.read(1, this.ackMs, this.signal);
    const pid = await this.io.read(m + 1, this.ackMs, this.signal);
    await this.waitAck(this.ackMs, 'akhir Get ID');
    if (pid.length < 2) throw new BootloaderError('protocol', 'Respons Get ID terlalu pendek.');
    const productId = (pid[0] << 8) | pid[1];

    this.info = { version, commands, productId };
    return this.info;
  }

  // ─── memory ops ───────────────────────────────────────────────────────────

  async readMemory(address: number, length: number): Promise<Uint8Array> {
    if (length < 1 || length > MAX_CHUNK) throw new RangeError(`length harus 1..${MAX_CHUNK}`);
    await this.sendCommand(CMD_READ_MEMORY);
    await this.sendAddress(address);
    const n = length - 1;
    await this.io.write(Uint8Array.of(n, n ^ 0xff));
    await this.waitAck(this.ackMs, 'jumlah byte Read');
    return this.io.read(length, this.ackMs, this.signal);
  }

  async writeMemory(address: number, data: Uint8Array): Promise<void> {
    if (data.length < 1 || data.length > MAX_CHUNK || data.length % 4 !== 0) {
      throw new RangeError('data write harus 4..256 byte dan kelipatan 4');
    }
    if (address % 4 !== 0) throw new RangeError('alamat write harus kelipatan 4');
    await this.sendCommand(CMD_WRITE_MEMORY);
    await this.sendAddress(address);
    const frame = new Uint8Array(data.length + 2);
    frame[0] = data.length - 1;
    frame.set(data, 1);
    frame[frame.length - 1] = xorOf(frame.subarray(0, frame.length - 1));
    await this.io.write(frame);
    await this.waitAck(this.ackMs, `data write @ ${hex(address, 8)}`);
  }

  async go(address: number): Promise<void> {
    await this.sendCommand(CMD_GO);
    await this.sendAddress(address);
  }

  async erase(mode: EraseMode = 'mass'): Promise<void> {
    if (!this.info) throw new BootloaderError('protocol', 'connect() belum dipanggil.');
    const ext = this.info.commands.includes(CMD_EXTENDED_ERASE);
    const legacy = this.info.commands.includes(CMD_ERASE);
    if (!ext && !legacy) throw new BootloaderError('protocol', 'Device tidak melaporkan command Erase (0x43/0x44).');

    if (ext) {
      await this.sendCommand(CMD_EXTENDED_ERASE);
      if (mode === 'mass') {
        await this.io.write(Uint8Array.of(0xff, 0xff, 0x00)); // special erase: global mass erase
      } else {
        const s = mode.sectors;
        if (s.length === 0 || s.length > 0xffef) throw new RangeError('jumlah sektor tidak valid');
        const frame = new Uint8Array(2 + s.length * 2 + 1);
        frame[0] = ((s.length - 1) >> 8) & 0xff;
        frame[1] = (s.length - 1) & 0xff;
        s.forEach((sec, i) => {
          if (!Number.isInteger(sec) || sec < 0 || sec > 0xffef) throw new RangeError(`nomor sektor tidak valid: ${sec}`);
          frame[2 + i * 2] = (sec >> 8) & 0xff;
          frame[3 + i * 2] = sec & 0xff;
        });
        frame[frame.length - 1] = xorOf(frame.subarray(0, frame.length - 1));
        await this.io.write(frame);
      }
    } else {
      await this.sendCommand(CMD_ERASE);
      if (mode === 'mass') {
        await this.io.write(Uint8Array.of(0xff, 0x00));
      } else {
        const s = mode.sectors;
        if (s.length === 0 || s.length > 0xfe) throw new RangeError('jumlah page tidak valid (maks 254)');
        const frame = new Uint8Array(1 + s.length + 1);
        frame[0] = s.length - 1;
        s.forEach((pg, i) => {
          if (!Number.isInteger(pg) || pg < 0 || pg > 0xfe) throw new RangeError(`nomor page tidak valid: ${pg}`);
          frame[1 + i] = pg;
        });
        frame[frame.length - 1] = xorOf(frame.subarray(0, frame.length - 1));
        await this.io.write(frame);
      }
    }
    await this.waitAck(this.eraseMs, 'erase');
  }

  // ─── high-level flow ──────────────────────────────────────────────────────

  /** connect → erase → write → (verify) → (go). Port harus sudah terbuka 8E1 pada ByteStream. */
  async flash(opts: FlashOptions): Promise<FlashResult> {
    this.signal = opts.signal;
    this.log = opts.onLog ?? (() => {});
    const progress = opts.onProgress ?? (() => {});
    const verify = opts.verify ?? true;

    const segments = opts.segments.map(alignSegment);
    const total = segments.reduce((s, seg) => s + seg.data.length, 0);
    if (total === 0) throw new Error('Tidak ada data untuk ditulis.');

    progress({ phase: 'init', done: 0, total: 1 });
    this.log('Menghubungi bootloader…');
    const info = await this.connect();
    this.log(
      `Bootloader v${(info.version >> 4).toString()}.${(info.version & 0xf).toString()}, ` +
        `chip ID ${hex(info.productId, 4)}, command: ${info.commands.map((c) => hex(c)).join(' ')}`,
    );
    progress({ phase: 'init', done: 1, total: 1 });

    progress({ phase: 'erase', done: 0, total: 1 });
    this.log(opts.eraseMode && opts.eraseMode !== 'mass' ? 'Menghapus sektor terpilih…' : 'Menghapus seluruh flash (bisa beberapa detik)…');
    await this.erase(opts.eraseMode ?? 'mass');
    progress({ phase: 'erase', done: 1, total: 1 });

    this.log(`Menulis ${total} byte…`);
    let written = 0;
    progress({ phase: 'write', done: 0, total });
    for (const seg of segments) {
      for (let off = 0; off < seg.data.length; off += MAX_CHUNK) {
        this.checkAbort();
        const chunk = padTo4(seg.data.subarray(off, Math.min(off + MAX_CHUNK, seg.data.length)));
        await this.writeWithRetry(seg.address + off, chunk);
        written += Math.min(MAX_CHUNK, seg.data.length - off);
        progress({ phase: 'write', done: written, total });
      }
    }

    if (verify) {
      this.log('Memverifikasi (baca-ulang)…');
      let checked = 0;
      progress({ phase: 'verify', done: 0, total });
      for (const seg of segments) {
        for (let off = 0; off < seg.data.length; off += MAX_CHUNK) {
          this.checkAbort();
          const len = Math.min(MAX_CHUNK, seg.data.length - off);
          const got = await this.readMemory(seg.address + off, len);
          const want = seg.data.subarray(off, off + len);
          for (let i = 0; i < len; i++) {
            if (got[i] !== want[i]) {
              throw new BootloaderError(
                'verify',
                `Verifikasi gagal di ${hex(seg.address + off + i, 8)}: tertulis ${hex(got[i])}, seharusnya ${hex(want[i])}.`,
              );
            }
          }
          checked += len;
          progress({ phase: 'verify', done: checked, total });
        }
      }
      this.log('Verifikasi OK.');
    }

    let started = false;
    if (opts.goAddress != null) {
      progress({ phase: 'go', done: 0, total: 1 });
      try {
        await this.go(opts.goAddress);
        started = true;
        this.log(`Menjalankan aplikasi di ${hex(opts.goAddress, 8)}.`);
      } catch (err) {
        if (err instanceof BootloaderError && err.kind === 'nack') {
          this.log('Perintah Go ditolak device — firmware sudah tertulis; turunkan BOOT0 lalu reset manual.');
        } else {
          throw err;
        }
      }
      progress({ phase: 'go', done: 1, total: 1 });
    }
    return { started };
  }

  private async writeWithRetry(address: number, chunk: Uint8Array): Promise<void> {
    const attempts = 3;
    for (let i = 1; ; i++) {
      try {
        await this.writeMemory(address, chunk);
        return;
      } catch (err) {
        // Hanya NACK yang aman diulang (command dibatalkan bersih di sisi device).
        // Timeout/protocol error = keadaan tak diketahui → jangan menebak.
        if (err instanceof BootloaderError && err.kind === 'nack' && i < attempts) {
          this.log(`NACK saat menulis ${hex(address, 8)}, ulang ${i}/${attempts - 1}…`);
          this.io.flush();
          continue;
        }
        throw err;
      }
    }
  }
}

/** Write Memory mensyaratkan alamat kelipatan 4: rapatkan awal segmen dengan 0xFF (area itu sudah terhapus). */
function alignSegment(seg: FirmwareSegment): FirmwareSegment {
  const pad = seg.address % 4;
  if (pad === 0) return seg;
  const data = new Uint8Array(pad + seg.data.length).fill(0xff);
  data.set(seg.data, pad);
  return { address: seg.address - pad, data };
}

function padTo4(chunk: Uint8Array): Uint8Array {
  const rem = chunk.length % 4;
  if (rem === 0) return chunk;
  const out = new Uint8Array(chunk.length + (4 - rem)).fill(0xff);
  out.set(chunk, 0);
  return out;
}
