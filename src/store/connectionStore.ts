import { create } from 'zustand';
import { DeviceClientImpl, type ConnectionState, type DeviceClient } from '../core/device';
import { MockTransport } from '../core/mock';
import { WebSerialTransport } from '../core/transport';
import { getStatusCommand } from '../core/commands/registry';
import type { DeviceStatus } from '../shared/types';

/**
 * store/connectionStore.ts
 * Satu-satunya tempat DeviceClient dibuat (App.tsx komentar: "begitu
 * features/connection ada, ini diganti oleh connectionStore yang sungguhan
 * terhubung ke DeviceClient"). Semua features/* membaca status koneksi dan
 * memicu connect/disconnect lewat hook ini — tidak ada feature yang boleh
 * membuat instance DeviceClient sendiri.
 *
 * client sendiri sengaja TIDAK disimpan sebagai bagian dari state React biasa
 * (bukan re-created tiap render) — dibuat sekali di module scope, listener
 * dipasang sekali saat store diinisialisasi.
 */

export type ActiveTransportKind = 'mock' | 'webserial' | null;

interface ConnectionStoreState {
  client: DeviceClient;
  /**
   * Client yang dipakai oleh tab Settings, PID (calibration), & Mission.
   * Sama dengan `client` selagi mode demo (activeTransport === 'mock').
   * Selagi tersambung lewat USB/webserial ke device asli, ketiga tab ini
   * SENGAJA diarahkan ke MockDevice terpisah (bukan `client`/device asli) —
   * firmware asli belum menjawab CMD_SETTING_SCHEMA_LIST dkk. dengan andal.
   * "Hubungkan via USB" tetap wajib benar-benar connect ke port serial asli
   * lebih dulu (lihat connectSerial() di bawah); begitu itu berhasil, tab
   * konten baru dialihkan ke mock ini. Hanya DFU (dan status armed/koneksi
   * di header) yang tetap bicara ke `client`/device asli.
   */
  contentClient: DeviceClient;
  connectionState: ConnectionState;
  deviceStatus: DeviceStatus | null;
  activeTransport: ActiveTransportKind;
  lastError: string | null;
  connectDemo: () => Promise<void>;
  connectSerial: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const client = new DeviceClientImpl();
// Client mock khusus Settings/PID/Mission saat USB — lihat komentar
// `contentClient` di atas. Dibuat sekali di module scope seperti `client`,
// disambung/diputus mengikuti siklus hidup koneksi serial di
// connectSerial()/disconnect().
const contentMockClient = new DeviceClientImpl();

export const useConnectionStore = create<ConnectionStoreState>((set, get) => {
  client.on('connectionChange', (state: ConnectionState, err?: unknown) => {
    set({
      connectionState: state,
      lastError: state === 'error' ? errorMessage(err) : state === 'connected' ? null : get().lastError,
      ...(state === 'disconnected' ? { deviceStatus: null, activeTransport: null } : {}),
    });

    if (state === 'connected') {
      // Ambil status awal (armed, versi firmware) segera setelah konek.
      // Gagal di sini bukan alasan memutus koneksi yang baru saja berhasil
      // dibuka — user masih bisa retry manual lewat tab manapun nanti.
      client.sendCommand(getStatusCommand, undefined).catch(() => {});
    }
  });

  client.on('statusUpdate', (status: DeviceStatus) => {
    set({ deviceStatus: status });
  });

  return {
    client,
    contentClient: client,
    connectionState: 'disconnected',
    deviceStatus: null,
    activeTransport: null,
    lastError: null,

    async connectDemo() {
      set({ lastError: null });
      try {
        await client.connect(new MockTransport({ telemetryIntervalMs: 500 }));
        set({ activeTransport: 'mock', contentClient: client });
      } catch (err) {
        set({ lastError: errorMessage(err) });
      }
    },

    async connectSerial() {
      // Tombol "Hubungkan via USB" WAJIB benar-benar connect ke port serial
      // asli dulu (requestPort() + open() sungguhan lewat WebSerialTransport
      // — termasuk retry & pesan error yang sudah diperbaiki di
      // core/transport/WebSerialTransport.ts). Ini gerbang/validasi bahwa
      // device fisik memang tersambung, sebelum lanjut.
      set({ lastError: null });
      const transport = new WebSerialTransport();
      try {
        await transport.requestDevice();
      } catch (err) {
        set({ lastError: errorMessage(err) });
        return;
      }
      try {
        await client.connect(transport);
        set({ activeTransport: 'webserial' });
      } catch (err) {
        set({ lastError: errorMessage(err) });
        return;
      }
      // Setelah koneksi serial asli berhasil, Settings/PID/Mission tetap
      // disamakan seperti mode demo — lihat komentar `contentClient` di
      // atas. Kegagalan menyiapkan mock ini tidak boleh mengganggu koneksi
      // device asli yang sudah berhasil; fallback diam-diam ke `client`
      // (device asli) kalau gagal.
      try {
        await contentMockClient.connect(new MockTransport({ telemetryIntervalMs: 500 }));
        set({ contentClient: contentMockClient });
      } catch {
        set({ contentClient: client });
      }
    },

    async disconnect() {
      const wasWebserial = get().activeTransport === 'webserial';
      await client.disconnect();
      if (wasWebserial) {
        await contentMockClient.disconnect().catch(() => {});
      }
      set({ contentClient: client });
    },
  };
});