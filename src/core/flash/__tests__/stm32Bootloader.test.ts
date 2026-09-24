import { describe, expect, it } from 'vitest';
import { BootloaderError } from '../byteStream';
import { parseFirmware, parseIntelHex } from '../firmwareImage';
import { Stm32Bootloader, type FlashProgress } from '../stm32Bootloader';
import { FLASH_BASE, FakeBootloader, SECTOR_SIZE, type FakeBootloaderOptions } from './fakeBootloader';

const FAST = { ackMs: 200, eraseMs: 500, initRetryMs: 20, initAttempts: 4 };


/** Bangun satu record Intel HEX dengan checksum benar. */
function rec(type: number, offset: number, data: number[]): string {
  const bytes = [data.length, (offset >> 8) & 0xff, offset & 0xff, type, ...data];
  const cs = (0x100 - (bytes.reduce((a, b) => a + b, 0) & 0xff)) & 0xff;
  return ':' + [...bytes, cs].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

function makeImage(len: number, seed = 1): Uint8Array {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = (i * 31 + seed) & 0xfe; // tidak pernah 0xFF, supaya beda dari flash kosong
  return b;
}

function setup(opts: FakeBootloaderOptions = {}) {
  const dev = new FakeBootloader(opts);
  const bl = new Stm32Bootloader(dev, FAST);
  return { dev, bl };
}

async function expectKind(p: Promise<unknown>, kind: BootloaderError['kind']) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(BootloaderError);
  expect((err as BootloaderError).kind).toBe(kind);
}

describe('firmwareImage', () => {
  it('bin: satu segmen di alamat awal', () => {
    const img = parseFirmware('fw.bin', makeImage(100), 0x08004000);
    expect(img.segments).toHaveLength(1);
    expect(img.segments[0].address).toBe(0x08004000);
    expect(img.totalBytes).toBe(100);
  });

  it('menolak format tak dikenal & bin kosong', () => {
    expect(() => parseFirmware('fw.dfu', makeImage(10))).toThrow(/tidak didukung/);
    expect(() => parseFirmware('fw.bin', new Uint8Array(0))).toThrow(/kosong/);
  });

  it('hex: extended linear address + penggabungan record bersambung', () => {
    const hex = [
      rec(0x04, 0, [0x08, 0x00]), // base 0x08000000
      rec(0x00, 0x0000, [1, 2, 3, 4]),
      rec(0x00, 0x0004, [5, 6, 7, 8]), // bersambung → satu segmen
      rec(0x01, 0, []),
    ].join('\n');
    const segs = parseIntelHex(hex);
    expect(segs).toHaveLength(1);
    expect(segs[0].address).toBe(0x08000000);
    expect(Array.from(segs[0].data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('hex: dua segmen terpisah', () => {
    const hex = [
      rec(0x04, 0, [0x08, 0x00]),
      rec(0x00, 0x0000, [1, 2, 3, 4]),
      rec(0x00, 0x0100, [10, 11, 12, 13]),
      rec(0x01, 0, []),
    ].join('\n');
    const img = parseFirmware('a.hex', new TextEncoder().encode(hex));
    expect(img.segments.map((s) => s.address)).toEqual([0x08000000, 0x08000100]);
    expect(img.totalBytes).toBe(8);
  });

  it('hex: checksum salah & EOF hilang ditolak', () => {
    const good = rec(0x00, 0, [1, 2, 3, 4]);
    const bad = good.slice(0, -2) + ((parseInt(good.slice(-2), 16) + 1) & 0xff).toString(16).toUpperCase().padStart(2, '0');
    expect(() => parseIntelHex(bad + '\n' + rec(0x01, 0, []))).toThrow(/checksum/);
    expect(() => parseIntelHex(good)).toThrow(/end-of-file/);
  });
});

describe('Stm32Bootloader.flash', () => {
  it('jalur normal: mass erase → write → verify → go, isi flash sama dengan image', async () => {
    const { dev, bl } = setup();
    const image = makeImage(1003); // sengaja bukan kelipatan 4 & > 3 chunk
    const seen: FlashProgress[] = [];
    const res = await bl.flash({
      segments: [{ address: FLASH_BASE, data: image }],
      goAddress: FLASH_BASE,
      onProgress: (p) => seen.push(p),
    });

    expect(res.started).toBe(true);
    expect(dev.goAddress).toBe(FLASH_BASE);
    expect(dev.eraseCalls).toEqual(['mass']);
    expect(Array.from(dev.flash.subarray(0, 1003))).toEqual(Array.from(image));
    expect(dev.flash[1003]).toBe(0xff); // padding 0xFF, bukan sampah
    expect(bl.info).toMatchObject({ version: 0x31, productId: 0x0413 });

    const last = (phase: string) => [...seen].reverse().find((p) => p.phase === phase)!;
    expect(last('write')).toMatchObject({ done: 1003, total: 1003 });
    expect(last('verify')).toMatchObject({ done: 1003, total: 1003 });
    // urutan fase tidak boleh mundur
    const order = ['init', 'erase', 'write', 'verify', 'go'];
    const idx = seen.map((p) => order.indexOf(p.phase));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('tanpa go/verify: tidak mengirim Go dan tidak membaca ulang', async () => {
    const { dev, bl } = setup();
    const res = await bl.flash({ segments: [{ address: FLASH_BASE, data: makeImage(64) }], verify: false, goAddress: null });
    expect(res.started).toBe(false);
    expect(dev.goAddress).toBeNull();
    expect(dev.commandsSeen).not.toContain(0x11);
    expect(dev.commandsSeen).not.toContain(0x21);
  });

  it('memakai Erase legacy 0x43 kalau device tidak punya 0x44', async () => {
    const { dev, bl } = setup({ legacyErase: true });
    const image = makeImage(300);
    await bl.flash({ segments: [{ address: FLASH_BASE, data: image }] });
    expect(dev.commandsSeen).toContain(0x43);
    expect(dev.commandsSeen).not.toContain(0x44);
    expect(dev.eraseCalls).toEqual(['mass']);
    expect(Array.from(dev.flash.subarray(0, 300))).toEqual(Array.from(image));
  });

  it('sector erase (extended & legacy) hanya menghapus sektor yang diminta', async () => {
    for (const legacy of [false, true]) {
      const { dev, bl } = setup({ legacyErase: legacy });
      dev.flash.fill(0x00); // tandai isi lama; hanya sektor 1 yang boleh terhapus jadi 0xFF
      await bl.connect();
      await bl.erase({ sectors: [1] });
      expect(dev.eraseCalls).toEqual([[1]]);
      expect(dev.flash[SECTOR_SIZE - 1]).toBe(0x00);
      expect(dev.flash[SECTOR_SIZE]).toBe(0xff);
      expect(dev.flash[2 * SECTOR_SIZE - 1]).toBe(0xff);
      expect(dev.flash[2 * SECTOR_SIZE]).toBe(0x00);
    }
  });

  it('alamat segmen tidak rata-4 dirapatkan dengan 0xFF di depan', async () => {
    const { dev, bl } = setup();
    const image = makeImage(10);
    await bl.flash({ segments: [{ address: FLASH_BASE + 2, data: image }] });
    expect(dev.flash[0]).toBe(0xff);
    expect(dev.flash[1]).toBe(0xff);
    expect(Array.from(dev.flash.subarray(2, 12))).toEqual(Array.from(image));
  });

  it('dua segmen terpisah ditulis semua', async () => {
    const { dev, bl } = setup();
    const a = makeImage(20, 3);
    const b = makeImage(20, 5);
    await bl.flash({
      segments: [
        { address: FLASH_BASE, data: a },
        { address: FLASH_BASE + 0x1000, data: b },
      ],
    });
    expect(Array.from(dev.flash.subarray(0, 20))).toEqual(Array.from(a));
    expect(Array.from(dev.flash.subarray(0x1000, 0x1000 + 20))).toEqual(Array.from(b));
  });

  it('init diulang sampai bootloader menjawab', async () => {
    const { bl } = setup({ ignoreInitCount: 2 });
    const info = await bl.connect();
    expect(info.productId).toBe(0x0413);
  });

  it('NACK pada init (sudah aktif) dianggap OK', async () => {
    const { bl } = setup({ alreadyInitialized: true });
    await expect(bl.connect()).resolves.toMatchObject({ version: 0x31 });
  });

  it('tidak ada bootloader → timeout dengan pesan yang membantu', async () => {
    const { bl } = setup({ ignoreInitCount: 999 });
    const err = await bl.connect().catch((e) => e);
    expect(err).toBeInstanceOf(BootloaderError);
    expect(err.kind).toBe('timeout');
    expect(err.message).toMatch(/BOOT0/);
  });

  it('NACK pada satu chunk write diulang dan akhirnya berhasil', async () => {
    const { dev, bl } = setup({ nackWriteOnceAt: FLASH_BASE + 256 });
    const image = makeImage(600);
    const logs: string[] = [];
    await bl.flash({ segments: [{ address: FLASH_BASE, data: image }], onLog: (l) => logs.push(l) });
    expect(Array.from(dev.flash.subarray(0, 600))).toEqual(Array.from(image));
    expect(logs.some((l) => /NACK saat menulis/.test(l))).toBe(true);
  });

  it('verifikasi gagal kalau flash berisi byte salah', async () => {
    const { bl } = setup({ corruptAfterWriteAt: FLASH_BASE + 300 });
    await expectKind(bl.flash({ segments: [{ address: FLASH_BASE, data: makeImage(512) }] }), 'verify');
  });

  it('Go ditolak → flashing tetap dianggap sukses, started=false', async () => {
    const { dev, bl } = setup({ nackGo: true });
    const image = makeImage(64);
    const res = await bl.flash({ segments: [{ address: FLASH_BASE, data: image }], goAddress: FLASH_BASE });
    expect(res.started).toBe(false);
    expect(Array.from(dev.flash.subarray(0, 64))).toEqual(Array.from(image));
  });

  it('abort di tengah penulisan berhenti dengan kind=aborted', async () => {
    const ac = new AbortController();
    let chunks = 0;
    const { dev, bl } = setup({
      onWrite: () => {
        if (++chunks === 2) ac.abort();
      },
    });
    await expectKind(bl.flash({ segments: [{ address: FLASH_BASE, data: makeImage(2000) }], signal: ac.signal }), 'aborted');
    expect(chunks).toBe(2); // tidak lanjut menulis setelah abort
    expect(dev.goAddress).toBeNull();
  });

  it('firmware tanpa data ditolak sebelum menyentuh device', async () => {
    const { dev, bl } = setup();
    await expect(bl.flash({ segments: [] })).rejects.toThrow(/Tidak ada data/);
    expect(dev.commandsSeen).toHaveLength(0);
  });
});
