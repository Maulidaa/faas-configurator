import { create } from 'zustand';
import { BootloaderError } from '../../core/flash/byteStream';
import { STM32_FLASH_BASE, parseFirmware, type FirmwareImage } from '../../core/flash/firmwareImage';
import { Stm32Bootloader, type FlashPhase, type FlashProgress } from '../../core/flash/stm32Bootloader';
import { WebSerialByteStream, isWebSerialSupported } from '../../core/flash/webSerialByteStream';

/**
 * features/serialFlash/serialFlashStore.ts
 *
 * State alur "flash firmware lewat WebSerial" (ROM bootloader USART STM32,
 * lihat core/flash/stm32Bootloader.ts). Terpisah dari connectionStore dengan
 * sengaja: alur ini membuka port SENDIRI dengan konfigurasi 8E1 dan tidak
 * bicara protokol FAAS sama sekali — device ada di bootloader, bukan di
 * firmware FAAS, jadi tidak ada CMD_GET_STATUS/armed untuk ditanyakan.
 *
 * Isi file firmware & handle port/abort disimpan di module scope, bukan di
 * state zustand — sama alasannya dengan `client` di connectionStore.ts dan
 * `pollHandle` di calibrationStore.ts: bukan data serializable, tidak perlu
 * memicu re-render.
 */

export type SerialFlashStatus = 'idle' | 'running' | 'done' | 'error';

export interface ImagePreview {
  kind: 'bin' | 'hex';
  totalBytes: number;
  segments: { address: number; length: number }[];
}

const MAX_LOG_LINES = 300;

let fileName: string | null = null;
let fileBytes: Uint8Array | null = null;
let abortController: AbortController | null = null;

/** Terima "0x08004000", "08004000" atau "8004000" (selalu heksadesimal). Null kalau tidak valid. */
export function parseAddressText(text: string): number | null {
  const t = text.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{1,8}$/.test(t)) return null;
  return parseInt(t, 16) >>> 0;
}

function buildImage(startAddressText: string): FirmwareImage {
  if (!fileName || !fileBytes) throw new Error('Pilih file firmware dulu.');
  const isBin = fileName.toLowerCase().endsWith('.bin');
  let start = STM32_FLASH_BASE;
  if (isBin) {
    const parsed = parseAddressText(startAddressText);
    if (parsed === null) throw new Error('Alamat awal tidak valid — tulis heksadesimal, mis. 0x08000000.');
    start = parsed;
  }
  return parseFirmware(fileName, fileBytes, start);
}

function previewOf(image: FirmwareImage): ImagePreview {
  return {
    kind: image.kind,
    totalBytes: image.totalBytes,
    segments: image.segments.map((s) => ({ address: s.address, length: s.data.length })),
  };
}

function overallPct(p: FlashProgress, verify: boolean): number {
  const ranges: Record<FlashPhase, [number, number]> = verify
    ? { init: [0, 3], erase: [3, 10], write: [10, 60], verify: [60, 97], go: [97, 100] }
    : { init: [0, 3], erase: [3, 10], write: [10, 95], verify: [95, 95], go: [95, 100] };
  const [a, b] = ranges[p.phase];
  const frac = p.total > 0 ? p.done / p.total : 1;
  return Math.round(a + (b - a) * frac);
}

function describeError(err: unknown): string {
  if (err instanceof BootloaderError) return err.message;
  if (err instanceof DOMException) {
    if (err.name === 'InvalidStateError') {
      return 'Port serial sedang dipakai (mungkin koneksi FAAS masih aktif di port yang sama). Putuskan dulu lalu coba lagi.';
    }
    if (err.name === 'NetworkError') {
      return 'Gagal membuka port serial — dipakai aplikasi lain atau adapter terlepas.';
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

interface SerialFlashState {
  status: SerialFlashStatus;
  phase: FlashPhase | null;
  progressPct: number;
  log: string[];
  error: string | null;
  /** true/false setelah selesai: apakah perintah Go menjalankan aplikasi. null = belum/tidak dicoba. */
  started: boolean | null;

  fileName: string | null;
  preview: ImagePreview | null;
  fileError: string | null;

  startAddressText: string;
  baudRate: number;
  verify: boolean;
  runAfter: boolean;

  selectFile: (file: File) => Promise<void>;
  setStartAddressText: (text: string) => void;
  setBaudRate: (baud: number) => void;
  setVerify: (v: boolean) => void;
  setRunAfter: (v: boolean) => void;
  /** HARUS dipanggil langsung dari handler klik — requestPort() butuh user gesture. */
  start: () => Promise<void>;
  abort: () => void;
  reset: () => void;
}

export const useSerialFlashStore = create<SerialFlashState>((set, get) => {
  function addLog(line: string) {
    set((s) => ({ log: [...s.log, line].slice(-MAX_LOG_LINES) }));
  }

  function refreshPreview() {
    if (!fileName || !fileBytes) {
      set({ preview: null, fileError: null });
      return;
    }
    try {
      set({ preview: previewOf(buildImage(get().startAddressText)), fileError: null });
    } catch (err) {
      set({ preview: null, fileError: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    status: 'idle',
    phase: null,
    progressPct: 0,
    log: [],
    error: null,
    started: null,

    fileName: null,
    preview: null,
    fileError: null,

    startAddressText: '0x08000000',
    baudRate: 115200,
    verify: true,
    runAfter: true,

    async selectFile(file) {
      if (get().status === 'running') return;
      fileName = file.name;
      fileBytes = new Uint8Array(await file.arrayBuffer());
      set({ fileName: file.name, status: 'idle', error: null, started: null, progressPct: 0, phase: null, log: [] });
      refreshPreview();
    },

    setStartAddressText(text) {
      set({ startAddressText: text });
      refreshPreview();
    },
    setBaudRate: (baudRate) => set({ baudRate }),
    setVerify: (verify) => set({ verify }),
    setRunAfter: (runAfter) => set({ runAfter }),

    async start() {
      const s = get();
      if (s.status === 'running') return;

      if (!isWebSerialSupported()) {
        set({ status: 'error', error: 'Browser ini tidak mendukung Web Serial. Pakai Chrome atau Edge versi desktop.' });
        return;
      }

      // Validasi & parse SEBELUM requestPort: gagal cepat tanpa memunculkan dialog,
      // dan tidak ada await sebelum requestPort() sehingga user gesture tetap valid.
      let image: FirmwareImage;
      try {
        image = buildImage(s.startAddressText);
      } catch (err) {
        set({ status: 'error', error: describeError(err) });
        return;
      }

      const serial = navigator.serial;
      if (!serial) {
        set({ status: 'error', error: 'Browser ini tidak mendukung Web Serial (pakai Chrome/Edge desktop).' });
        return;
      }

      let port: SerialPort;
      try {
        port = await serial.requestPort();
      } catch (err) {
        // NotFoundError = user menutup dialog pemilih port tanpa memilih — bukan error.
        if (err instanceof DOMException && err.name === 'NotFoundError') return;
        set({ status: 'error', error: describeError(err) });
        return;
      }

      const ac = new AbortController();
      abortController = ac;
      const verify = s.verify;
      const goAddress = s.runAfter ? image.segments[0].address - (image.segments[0].address % 4) : null;

      set({ status: 'running', phase: 'init', progressPct: 0, log: [], error: null, started: null });
      addLog(`Membuka port @ ${s.baudRate} baud, 8E1…`);

      let stream: WebSerialByteStream | null = null;
      try {
        stream = await WebSerialByteStream.open(port, s.baudRate);
        const bootloader = new Stm32Bootloader(stream);
        const result = await bootloader.flash({
          segments: image.segments,
          verify,
          goAddress,
          signal: ac.signal,
          onLog: addLog,
          onProgress: (p) =>
            set((cur) => ({ phase: p.phase, progressPct: Math.max(cur.progressPct, overallPct(p, verify)) })),
        });
        set({ status: 'done', progressPct: 100, started: goAddress === null ? null : result.started });
        addLog('Selesai.');
      } catch (err) {
        const aborted = err instanceof BootloaderError && err.kind === 'aborted';
        set({
          status: 'error',
          error: aborted
            ? 'Dibatalkan. Firmware di device sekarang tidak lengkap — flash ulang sebelum dipakai.'
            : describeError(err),
        });
        addLog(aborted ? 'Dibatalkan oleh user.' : `Gagal: ${describeError(err)}`);
      } finally {
        abortController = null;
        await stream?.close();
      }
    },

    abort() {
      abortController?.abort();
    },

    reset() {
      if (get().status === 'running') return;
      set({ status: 'idle', phase: null, progressPct: 0, log: [], error: null, started: null });
    },
  };
});
