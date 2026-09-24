import { BufferedByteStream } from '../byteStream';

/**
 * Simulasi ROM bootloader STM32 (AN3155) di sisi "device" untuk test tanpa
 * hardware. Flash dimodelkan seperti aslinya: bit hanya bisa diubah 1→0
 * saat menulis (new = old & data), jadi menulis tanpa erase lebih dulu akan
 * menghasilkan data rusak dan ketahuan oleh test.
 */

const ACK = 0x79;
const NACK = 0x1f;
export const FLASH_BASE = 0x08000000;
export const SECTOR_SIZE = 0x4000; // 16 KiB seragam — cukup untuk test

export interface FakeBootloaderOptions {
  flashSize?: number;
  /** Pakai Erase 0x43 (legacy) alih-alih Extended Erase 0x44. */
  legacyErase?: boolean;
  /** Abaikan N byte init 0x7F pertama (simulasi board belum di-reset ke bootloader). */
  ignoreInitCount?: number;
  /** Anggap sudah di-init: 0x7F dijawab NACK. */
  alreadyInitialized?: boolean;
  /** NACK Write Memory PERTAMA pada alamat ini (sekali saja). */
  nackWriteOnceAt?: number;
  /** Setelah menulis, rusak-kan satu byte pada alamat ini (untuk test verifikasi). */
  corruptAfterWriteAt?: number;
  /** Jawab NACK untuk perintah Go (mis. read-protection). */
  nackGo?: boolean;
  productId?: number;
  /** Panggil tiap Write Memory selesai — dipakai test abort. */
  onWrite?: (address: number, length: number) => void;
}

export class FakeBootloader extends BufferedByteStream {
  flash: Uint8Array;
  commandsSeen: number[] = [];
  eraseCalls: Array<'mass' | number[]> = [];
  goAddress: number | null = null;
  closed = false;

  private rx: number[] = [];
  private initialized: boolean;
  private ignoreInit: number;
  private nackedWrite = false;
  private state:
    | { s: 'cmd' }
    | { s: 'addr'; cmd: number }
    | { s: 'wdata'; addr: number }
    | { s: 'rlen'; addr: number }
    | { s: 'erase' } = { s: 'cmd' };

  private opts: FakeBootloaderOptions;

  constructor(opts: FakeBootloaderOptions = {}) {
    super();
    this.opts = opts;
    this.flash = new Uint8Array(opts.flashSize ?? 0x10000).fill(0xff);
    this.initialized = opts.alreadyInitialized ?? false;
    this.ignoreInit = opts.ignoreInitCount ?? 0;
  }

  async write(data: Uint8Array): Promise<void> {
    for (const b of data) this.rx.push(b);
    this.process();
  }

  private send(...bytes: number[]): void {
    this.push(Uint8Array.from(bytes));
  }

  private supportedCommands(): number[] {
    return [0x00, 0x02, 0x11, 0x21, 0x31, this.opts.legacyErase ? 0x43 : 0x44, 0x63, 0x73, 0x82, 0x92];
  }

  private process(): void {
    for (;;) {
      if (this.state.s === 'cmd') {
        if (this.rx.length === 0) return;
        if (this.rx[0] === 0x7f) {
          this.rx.shift();
          if (this.ignoreInit > 0) {
            this.ignoreInit--;
          } else if (this.initialized) {
            this.send(NACK);
          } else {
            this.initialized = true;
            this.send(ACK);
          }
          continue;
        }
        if (this.rx.length < 2) return;
        const cmd = this.rx.shift()!;
        const inv = this.rx.shift()!;
        if ((cmd ^ inv) !== 0xff) {
          this.send(NACK);
          continue;
        }
        this.commandsSeen.push(cmd);
        this.handleCommand(cmd);
        continue;
      }

      if (this.state.s === 'addr') {
        if (this.rx.length < 5) return;
        const b = this.rx.splice(0, 5);
        const addr = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
        const cs = b[0] ^ b[1] ^ b[2] ^ b[3];
        const cmd = this.state.cmd;
        if (cs !== b[4]) {
          this.send(NACK);
          this.state = { s: 'cmd' };
          continue;
        }
        if (cmd === 0x31) {
          if (this.opts.nackWriteOnceAt === addr && !this.nackedWrite) {
            this.nackedWrite = true;
            this.send(NACK);
            this.state = { s: 'cmd' };
            continue;
          }
          this.send(ACK);
          this.state = { s: 'wdata', addr };
        } else if (cmd === 0x11) {
          this.send(ACK);
          this.state = { s: 'rlen', addr };
        } else if (cmd === 0x21) {
          if (this.opts.nackGo) {
            this.send(NACK);
          } else {
            this.goAddress = addr;
            this.send(ACK);
          }
          this.state = { s: 'cmd' };
        }
        continue;
      }

      if (this.state.s === 'wdata') {
        if (this.rx.length < 1) return;
        const n = this.rx[0] + 1;
        if (this.rx.length < 1 + n + 1) return;
        const frame = this.rx.splice(0, 1 + n + 1);
        let x = 0;
        for (let i = 0; i < frame.length - 1; i++) x ^= frame[i];
        const addr = this.state.addr;
        this.state = { s: 'cmd' };
        if (x !== frame[frame.length - 1] || n % 4 !== 0 || addr % 4 !== 0) {
          this.send(NACK);
          continue;
        }
        const off = addr - FLASH_BASE;
        for (let i = 0; i < n; i++) this.flash[off + i] &= frame[1 + i];
        const bad = this.opts.corruptAfterWriteAt;
        if (bad !== undefined && bad >= addr && bad < addr + n) this.flash[bad - FLASH_BASE] ^= 0x01;
        this.send(ACK);
        this.opts.onWrite?.(addr, n);
        continue;
      }

      if (this.state.s === 'rlen') {
        if (this.rx.length < 2) return;
        const [n1, inv] = this.rx.splice(0, 2);
        const addr = this.state.addr;
        this.state = { s: 'cmd' };
        if ((n1 ^ inv) !== 0xff) {
          this.send(NACK);
          continue;
        }
        this.send(ACK);
        const off = addr - FLASH_BASE;
        this.push(this.flash.slice(off, off + n1 + 1));
        continue;
      }

      if (this.state.s === 'erase') {
        if (!this.handleErase()) return;
        continue;
      }
    }
  }

  private handleCommand(cmd: number): void {
    switch (cmd) {
      case 0x00: {
        const cmds = this.supportedCommands();
        this.send(ACK, cmds.length, 0x31 /* v3.1 */, ...cmds, ACK);
        break;
      }
      case 0x02:
        this.send(ACK, 1, (this.opts.productId ?? 0x0413) >> 8, (this.opts.productId ?? 0x0413) & 0xff, ACK);
        break;
      case 0x11:
      case 0x31:
      case 0x21:
        this.send(ACK);
        this.state = { s: 'addr', cmd };
        break;
      case 0x43:
      case 0x44:
        this.send(ACK);
        this.state = { s: 'erase' };
        break;
      default:
        this.send(NACK);
    }
  }

  /** Return true kalau frame erase utuh sudah dikonsumsi. */
  private handleErase(): boolean {
    const ext = this.commandsSeen[this.commandsSeen.length - 1] === 0x44;
    const x = (bytes: number[]) => bytes.reduce((a, b) => a ^ b, 0);

    if (ext) {
      if (this.rx.length < 2) return false;
      const n = (this.rx[0] << 8) | this.rx[1];
      if (n === 0xffff) {
        if (this.rx.length < 3) return false;
        const f = this.rx.splice(0, 3);
        this.state = { s: 'cmd' };
        if (x(f.slice(0, 2)) !== f[2]) return this.nack();
        return this.massErase();
      }
      const need = 2 + (n + 1) * 2 + 1;
      if (this.rx.length < need) return false;
      const f = this.rx.splice(0, need);
      this.state = { s: 'cmd' };
      if (x(f.slice(0, need - 1)) !== f[need - 1]) return this.nack();
      const sectors: number[] = [];
      for (let i = 0; i <= n; i++) sectors.push((f[2 + i * 2] << 8) | f[3 + i * 2]);
      return this.sectorErase(sectors);
    }

    if (this.rx.length < 1) return false;
    if (this.rx[0] === 0xff) {
      if (this.rx.length < 2) return false;
      this.rx.splice(0, 2);
      this.state = { s: 'cmd' };
      return this.massErase();
    }
    const n = this.rx[0] + 1;
    if (this.rx.length < 1 + n + 1) return false;
    const f = this.rx.splice(0, 1 + n + 1);
    this.state = { s: 'cmd' };
    if (x(f.slice(0, 1 + n)) !== f[1 + n]) return this.nack();
    return this.sectorErase(f.slice(1, 1 + n));
  }

  private nack(): boolean {
    this.send(NACK);
    return true;
  }

  private massErase(): boolean {
    this.eraseCalls.push('mass');
    this.flash.fill(0xff);
    this.send(ACK);
    return true;
  }

  private sectorErase(sectors: number[]): boolean {
    this.eraseCalls.push(sectors);
    for (const s of sectors) this.flash.fill(0xff, s * SECTOR_SIZE, (s + 1) * SECTOR_SIZE);
    this.send(ACK);
    return true;
  }
}

