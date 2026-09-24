/**
 * core/flash/firmwareImage.ts
 *
 * Mengubah file firmware yang dipilih user jadi daftar segmen
 * { address, data } siap-tulis. Mendukung:
 *  - .bin  : biner mentah, ditaruh di `binStartAddress` (default 0x08000000,
 *            awal flash STM32) — file .bin tidak menyimpan alamat sendiri.
 *  - .hex  : Intel HEX, alamat diambil dari file (record tipe 00/01/02/04).
 * Format lain (mis. .dfu/DfuSe, .elf, .apj) sengaja ditolak dengan pesan
 * jelas alih-alih ditebak — menulis byte header ke flash akan merusak firmware.
 */

export const STM32_FLASH_BASE = 0x08000000;

export interface FirmwareSegment {
  address: number;
  data: Uint8Array;
}

export interface FirmwareImage {
  kind: 'bin' | 'hex';
  segments: FirmwareSegment[];
  totalBytes: number;
}

export function parseFirmware(fileName: string, bytes: Uint8Array, binStartAddress = STM32_FLASH_BASE): FirmwareImage {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.hex') || lower.endsWith('.ihx')) {
    return finalize('hex', parseIntelHex(new TextDecoder('ascii').decode(bytes)));
  }
  if (lower.endsWith('.bin')) {
    if (bytes.length === 0) throw new Error('File .bin kosong.');
    if (!Number.isInteger(binStartAddress) || binStartAddress < 0 || binStartAddress > 0xffffffff) {
      throw new Error('Alamat awal tidak valid.');
    }
    if (binStartAddress + bytes.length > 0x100000000) {
      throw new Error('Firmware melewati batas ruang alamat 32-bit dari alamat awal ini.');
    }
    return finalize('bin', [{ address: binStartAddress, data: bytes }]);
  }
  throw new Error('Format file tidak didukung — gunakan .bin atau .hex (bukan .dfu/.elf/.apj).');
}

function finalize(kind: 'bin' | 'hex', segments: FirmwareSegment[]): FirmwareImage {
  const sorted = [...segments].sort((a, b) => a.address - b.address);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (prev.address + prev.data.length > sorted[i].address) {
      throw new Error(
        `Segmen firmware saling tumpang-tindih di 0x${sorted[i].address.toString(16)} — file HEX tidak valid.`,
      );
    }
  }
  const totalBytes = sorted.reduce((sum, s) => sum + s.data.length, 0);
  if (totalBytes === 0) throw new Error('File firmware tidak berisi data.');
  return { kind, segments: sorted, totalBytes };
}

/** Intel HEX → segmen. Record yang berurutan/bersambung digabung jadi satu segmen. */
export function parseIntelHex(text: string): FirmwareSegment[] {
  const segments: FirmwareSegment[] = [];
  let base = 0;
  let cur: { address: number; chunks: Uint8Array[]; length: number } | null = null;
  let sawEof = false;

  const flushCur = () => {
    if (!cur) return;
    const data = new Uint8Array(cur.length);
    let off = 0;
    for (const c of cur.chunks) {
      data.set(c, off);
      off += c.length;
    }
    segments.push({ address: cur.address, data });
    cur = null;
  };

  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (line === '') continue;
    const where = `baris ${ln + 1}`;
    if (line[0] !== ':') throw new Error(`HEX tidak valid di ${where}: tidak diawali ':'.`);
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length % 2 === 0) {
      throw new Error(`HEX tidak valid di ${where}: karakter/panjang salah.`);
    }
    const raw = new Uint8Array((line.length - 1) / 2);
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(line.substr(1 + i * 2, 2), 16);
    if (raw.length < 5) throw new Error(`HEX tidak valid di ${where}: record terlalu pendek.`);

    const count = raw[0];
    if (raw.length !== count + 5) throw new Error(`HEX tidak valid di ${where}: panjang record tidak cocok.`);
    let sum = 0;
    for (const b of raw) sum = (sum + b) & 0xff;
    if (sum !== 0) throw new Error(`HEX tidak valid di ${where}: checksum salah.`);

    const offset = (raw[1] << 8) | raw[2];
    const type = raw[3];
    const data = raw.subarray(4, 4 + count);

    switch (type) {
      case 0x00: {
        const addr = (base + offset) >>> 0;
        if (cur && cur.address + cur.length === addr) {
          cur.chunks.push(data.slice());
          cur.length += data.length;
        } else {
          flushCur();
          cur = { address: addr, chunks: [data.slice()], length: data.length };
        }
        break;
      }
      case 0x01:
        sawEof = true;
        break;
      case 0x02:
        if (count !== 2) throw new Error(`HEX tidak valid di ${where}: record 02 harus 2 byte.`);
        base = ((data[0] << 8) | data[1]) * 16;
        break;
      case 0x04:
        if (count !== 2) throw new Error(`HEX tidak valid di ${where}: record 04 harus 2 byte.`);
        base = ((data[0] << 8) | data[1]) * 0x10000;
        break;
      case 0x03:
      case 0x05:
        break; // start address (CS:IP / EIP) — tidak relevan untuk flashing
      default:
        throw new Error(`HEX tidak valid di ${where}: tipe record 0x${type.toString(16)} tidak dikenal.`);
    }
    if (sawEof) break;
  }
  flushCur();
  if (!sawEof) throw new Error('File HEX terpotong: record end-of-file (01) tidak ditemukan.');
  return segments;
}
