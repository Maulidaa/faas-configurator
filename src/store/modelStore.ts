import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * store/modelStore.ts
 * Pilihan jenis airframe (V-tail / Quadcopter), diminta di layar paling
 * depan SEBELUM alur koneksi device maupun tuning (App.tsx merender
 * features/model/ModelSelectPanel duluan, sebelum ConnectionPanel/tab-strip).
 *
 * Firmware saat ini (protocol.md Bagian 8-9, firmware-architecture-stm32f411.md
 * Bagian 1 & 3.7) HANYA mendukung airframe fixed-wing V-tail — grup setting
 * `mixer` (vtail_ruddervator_gain, aileron_differential_pct) murni untuk
 * V-tail, belum ada skema mixer quadcopter di firmware/protokol manapun.
 * Karena itu 'quadcopter' sengaja tidak bisa dipilih dari UI (lihat
 * ModelSelectPanel, opsi N/A) — union tipe tetap mencantumkannya supaya
 * begitu firmware quad tersedia nanti, cukup buka opsinya di panel tanpa
 * perlu ubah tipe ini.
 *
 * Dipersist ke localStorage (bukan session-only) supaya user tidak perlu
 * pilih ulang tiap refresh — device fisik yang disambungkan tetap airframe
 * yang sama antar sesi konfigurasi.
 */
export type AircraftModel = 'vtail' | 'quadcopter';

interface ModelStoreState {
  selectedModel: AircraftModel | null;
  selectModel: (model: AircraftModel) => void;
  resetModel: () => void;
}

export const useModelStore = create<ModelStoreState>()(
  persist(
    (set) => ({
      selectedModel: null,
      selectModel: (model) => set({ selectedModel: model }),
      resetModel: () => set({ selectedModel: null }),
    }),
    { name: 'faas-model-selection' },
  ),
);
