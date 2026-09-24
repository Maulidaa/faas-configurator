import { create } from 'zustand';
import { sendPaginatedCommand, type DeviceClient } from '../../core/device';
import {
  settingCommitCommand,
  settingGetCommand,
  settingSchemaListCommand,
  settingSetCommand,
} from '../../core/commands/registry';
import type { SettingFieldSchema } from '../../shared/types';

/**
 * features/calibration/calibrationStore.ts
 *
 * "Kalibrasi" di proyek ini = kalibrasi (tuning) gain PID, bukan kalibrasi
 * sensor. Tidak ada command baru di protokol: gain PID dibaca/ditulis lewat
 * command Settings yang sudah ada (CMD_SETTING_SCHEMA_LIST/GET/SET/COMMIT),
 * dengan key `pid.<axis>.<term>` — mis. `pid.roll.kp`. Firmware (stabilize.c)
 * punya dua loop PID: roll & pitch; yaw tidak di-PID-kan di v1.
 *
 * Alur yang dijaga store ini:
 *   load    : ambil schema (min/max/step per gain) lalu GET tiap gain.
 *   apply   : SET tiga gain satu axis ke RAM device, lalu GET ulang —
 *             device boleh meng-clamp nilai, jadi yang ditampilkan adalah
 *             nilai SEBENARNYA yang berlaku, bukan yang dikirim.
 *   commit  : simpan permanen ke flash (semua setting, bukan cuma PID —
 *             CMD_SETTING_COMMIT memang tanpa payload).
 * Semua panggilan sekuensial: DeviceClient single in-flight, dan jumlah
 * command kecil (2 axis × 3 gain).
 */

export const PID_AXES = ['roll', 'pitch'] as const;
export const PID_TERMS = ['kp', 'ki', 'kd'] as const;

export type PidAxis = (typeof PID_AXES)[number];
export type PidTerm = (typeof PID_TERMS)[number];
export type PidGains = Record<PidTerm, number>;

export const pidKey = (axis: PidAxis, term: PidTerm): string => `pid.${axis}.${term}`;

export interface PidLimits {
  min?: number;
  max?: number;
  step?: number;
  readonlyWhenArmed: boolean;
}

/** unavailable = firmware belum mengekspos key pid.<axis>.* di schema-nya. */
export type AxisStatus = 'idle' | 'loading' | 'applying' | 'applied' | 'rejected' | 'error' | 'unavailable';
export type CommitStatus = 'idle' | 'committing' | 'ok' | 'rejected' | 'error';

export interface AxisState {
  /** Nilai terakhir yang dibaca dari device (RAM), null sebelum load pertama sukses. */
  gains: PidGains | null;
  status: AxisStatus;
  error: string | null;
}

interface CalibrationStoreState {
  axes: Record<PidAxis, AxisState>;
  limits: Record<string, PidLimits>;
  loading: boolean;
  schemaError: string | null;
  commitStatus: CommitStatus;

  load: (client: DeviceClient) => Promise<void>;
  apply: (client: DeviceClient, axis: PidAxis, gains: PidGains) => Promise<void>;
  commit: (client: DeviceClient) => Promise<void>;
  reset: () => void;
}

const emptyAxis = (): AxisState => ({ gains: null, status: 'idle', error: null });
const initialAxes = (): Record<PidAxis, AxisState> => ({ roll: emptyAxis(), pitch: emptyAxis() });

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function collectLeaves(fields: SettingFieldSchema[], out: Map<string, SettingFieldSchema>): void {
  for (const f of fields) {
    if (f.type === 'group') collectLeaves(f.children ?? [], out);
    else out.set(f.key, f);
  }
}

async function readAxis(client: DeviceClient, axis: PidAxis): Promise<PidGains> {
  const gains = { kp: 0, ki: 0, kd: 0 } as PidGains;
  for (const term of PID_TERMS) {
    const value = await client.sendCommand(settingGetCommand, { key: pidKey(axis, term) });
    if (typeof value !== 'number') throw new Error(`${pidKey(axis, term)} bukan angka (dapat ${typeof value})`);
    gains[term] = value;
  }
  return gains;
}

export const useCalibrationStore = create<CalibrationStoreState>((set, get) => {
  const patchAxis = (axis: PidAxis, patch: Partial<AxisState>) =>
    set((s) => ({ axes: { ...s.axes, [axis]: { ...s.axes[axis], ...patch } } }));

  return {
    axes: initialAxes(),
    limits: {},
    loading: false,
    schemaError: null,
    commitStatus: 'idle',

    async load(client) {
      set({ loading: true, schemaError: null });
      try {
        const pages = await sendPaginatedCommand(client, settingSchemaListCommand, (page) => ({
          hasMore: page.hasMore,
          items: page.fields,
        }));
        const leaves = new Map<string, SettingFieldSchema>();
        collectLeaves(pages, leaves);

        const limits: Record<string, PidLimits> = {};
        for (const axis of PID_AXES) {
          for (const term of PID_TERMS) {
            const f = leaves.get(pidKey(axis, term));
            if (f) limits[f.key] = { min: f.min, max: f.max, step: f.step, readonlyWhenArmed: !!f.readonlyWhenArmed };
          }
        }
        set({ limits });

        for (const axis of PID_AXES) {
          const present = PID_TERMS.every((t) => leaves.has(pidKey(axis, t)));
          if (!present) {
            patchAxis(axis, { gains: null, status: 'unavailable', error: null });
            continue;
          }
          patchAxis(axis, { status: 'loading', error: null });
          try {
            patchAxis(axis, { gains: await readAxis(client, axis), status: 'idle' });
          } catch (err) {
            patchAxis(axis, { status: 'error', error: errMsg(err) });
          }
        }
      } catch (err) {
        set({ schemaError: errMsg(err) });
      } finally {
        set({ loading: false });
      }
    },

    async apply(client, axis, gains) {
      if (get().axes[axis].status === 'applying') return;
      patchAxis(axis, { status: 'applying', error: null });
      set({ commitStatus: 'idle' });

      let rejectedTerm: PidTerm | null = null;
      try {
        for (const term of PID_TERMS) {
          const result = await client.sendCommand(settingSetCommand, {
            key: pidKey(axis, term),
            type: 'number',
            value: gains[term],
          });
          if (!result.ok) {
            rejectedTerm = term;
            break;
          }
        }
        // Baca ulang apa pun hasilnya: kalau ada term yang ditolak di tengah,
        // term sebelumnya sudah terlanjur berlaku dan UI harus jujur soal itu.
        const actual = await readAxis(client, axis);
        if (rejectedTerm) {
          patchAxis(axis, {
            gains: actual,
            status: 'rejected',
            error: `Device menolak ${rejectedTerm.toUpperCase()} (mis. setting terkunci saat armed). Gain yang tampil adalah nilai aktual di device.`,
          });
        } else {
          patchAxis(axis, { gains: actual, status: 'applied' });
        }
      } catch (err) {
        patchAxis(axis, { status: 'error', error: errMsg(err) });
      }
    },

    async commit(client) {
      set({ commitStatus: 'committing' });
      try {
        const result = await client.sendCommand(settingCommitCommand, undefined);
        set({ commitStatus: result.ok ? 'ok' : 'rejected' });
      } catch {
        set({ commitStatus: 'error' });
      }
    },

    reset() {
      set({ axes: initialAxes(), limits: {}, loading: false, schemaError: null, commitStatus: 'idle' });
    },
  };
});
