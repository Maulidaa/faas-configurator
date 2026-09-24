import type { SettingFieldSchema, SettingValue } from '../../shared/types';

/**
 * core/mock/mockSchema.ts
 * Schema palsu untuk MockDevice — cukup representatif untuk menguji UI
 * SchemaField generik (grup bersarang, enum, bool, number, readonlyWhenArmed)
 * tanpa perlu hardware. Mengikuti bentuk output_mapping (protocol.md Bagian 8)
 * dan mixer (Bagian 9) v1 default V-tail.
 */

/**
 * `output` PERNAH jadi satu grup dengan 5 children (5 pin, masing-masing
 * enum 3 opsi) — encoded size-nya 423 byte SENDIRIAN, jauh di atas
 * MAX_PAYLOAD_SIZE (255). Karena satu top-level field/grup tidak pernah
 * dipecah lintas-page (protocol.md Bagian 6: pagination cuma memecah
 * ANTAR field, bukan di DALAM satu field), grup itu tidak mungkin pernah
 * muat dalam 1 frame berapa pun cara page-nya diatur. Dipecah jadi 3
 * grup lebih kecil ("bank") supaya tiap grup, sendirian, aman di bawah
 * budget (lihat MAX_ITEM_BYTES di MockDevice.ts) — bukan sekadar dipecah
 * ke page yang beda.
 */
const roleOptions = [
  { value: 0, label: 'NONE' }, { value: 1, label: 'MOTOR' }, { value: 2, label: 'SERVO' },
];

const outputBankA: SettingFieldSchema = {
  key: 'output_bank_a',
  label: 'Output Mapping (Pin 0-1)',
  type: 'group',
  readonlyWhenArmed: true,
  children: [
    { key: 'output.pin0.role', label: 'Pin 0 Role', type: 'enum', readonlyWhenArmed: true, enumOptions: roleOptions },
    { key: 'output.pin0.index', label: 'Pin 0 Index', type: 'number', readonlyWhenArmed: true, min: 0, max: 3, step: 1 },
    { key: 'output.pin1.role', label: 'Pin 1 Role (AIL_L)', type: 'enum', readonlyWhenArmed: true, enumOptions: roleOptions },
  ],
}; // ~223 byte encoded

const outputBankB: SettingFieldSchema = {
  key: 'output_bank_b',
  label: 'Output Mapping (Pin 2-3)',
  type: 'group',
  readonlyWhenArmed: true,
  children: [
    { key: 'output.pin2.role', label: 'Pin 2 Role (AIL_R)', type: 'enum', readonlyWhenArmed: true, enumOptions: roleOptions },
    { key: 'output.pin3.role', label: 'Pin 3 Role (VTAIL_L)', type: 'enum', readonlyWhenArmed: true, enumOptions: roleOptions },
  ],
}; // ~186 byte encoded

const outputBankC: SettingFieldSchema = {
  key: 'output_bank_c',
  label: 'Output Mapping (Pin 4)',
  type: 'group',
  readonlyWhenArmed: true,
  children: [
    { key: 'output.pin4.role', label: 'Pin 4 Role (VTAIL_R)', type: 'enum', readonlyWhenArmed: true, enumOptions: roleOptions },
  ],
}; // ~114 byte encoded

const mixer: SettingFieldSchema = {
  key: 'mixer',
  label: 'Mixer',
  type: 'group',
  readonlyWhenArmed: true,
  children: [
    {
      key: 'mixer.vtail_ruddervator_gain', label: 'V-tail Ruddervator Gain', type: 'number',
      readonlyWhenArmed: true, min: 0, max: 2, step: 0.05,
    },
    {
      key: 'mixer.aileron_differential_pct', label: 'Aileron Differential (%)', type: 'number',
      readonlyWhenArmed: true, min: 0, max: 100, step: 1, unit: '%',
    },
  ],
};

/**
 * Gain PID roll & pitch (stabilize.c: roll_pid / pitch_pid). Sengaja TIDAK
 * readonlyWhenArmed — PID_SetGains() didesain aman dipanggil saat terbang
 * (tidak mereset integral), dan tuning PID memang dilakukan lewat perubahan
 * kecil berulang. Dipecah per axis supaya tiap grup muat satu frame.
 */
function pidGroup(axis: 'roll' | 'pitch', label: string): SettingFieldSchema {
  return {
    key: `pid_${axis}`,
    label: `PID ${label}`,
    type: 'group',
    children: [
      { key: `pid.${axis}.kp`, label: `${label} Kp`, type: 'number', min: 0, max: 5, step: 0.01 },
      { key: `pid.${axis}.ki`, label: `${label} Ki`, type: 'number', min: 0, max: 2, step: 0.01 },
      { key: `pid.${axis}.kd`, label: `${label} Kd`, type: 'number', min: 0, max: 1, step: 0.001 },
    ],
  };
}

const pidRoll = pidGroup('roll', 'Roll');
const pidPitch = pidGroup('pitch', 'Pitch');

const safety: SettingFieldSchema = {
  key: 'safety',
  label: 'Safety',
  type: 'group',
  children: [
    { key: 'safety.rth_failsafe_enabled', label: 'RTH on Failsafe', type: 'bool', readonlyWhenArmed: true },
  ],
};

const telemetry: SettingFieldSchema = {
  key: 'telemetry',
  label: 'Telemetry',
  type: 'group',
  children: [
    {
      key: 'telemetry.update_rate_hz', label: 'Update Rate', type: 'number',
      min: 1, max: 20, step: 1, unit: 'Hz',
    },
  ],
};

/**
 * Daftar field top-level, flat (BUKAN sudah dibagi ke page manual). Urutan
 * di sini menentukan urutan tampil di UI settings tree. Pembagian ke page
 * sungguhan (respons CMD_SETTING_SCHEMA_LIST) dihitung dinamis di
 * MockDevice.encodeSchemaPage() berdasarkan ukuran encoded byte tiap field
 * — supaya kalau ada field baru ditambah di sini nanti, page otomatis
 * dibagi ulang, tidak perlu ada yang inget "jangan lupa cek 255 byte".
 */
export const MOCK_SCHEMA_FIELDS: SettingFieldSchema[] = [outputBankA, outputBankB, outputBankC, mixer, pidRoll, pidPitch, safety, telemetry];

function flattenLeaves(fields: SettingFieldSchema[], out: Map<string, SettingFieldSchema>): void {
  for (const f of fields) {
    if (f.type === 'group' && f.children) {
      flattenLeaves(f.children, out);
    } else {
      out.set(f.key, f);
    }
  }
}

export const MOCK_SCHEMA_FLAT: Map<string, SettingFieldSchema> = (() => {
  const map = new Map<string, SettingFieldSchema>();
  flattenLeaves(MOCK_SCHEMA_FIELDS, map);
  return map;
})();

export const MOCK_DEFAULT_VALUES: Record<string, SettingValue> = {
  'output.pin0.role': 1, // MOTOR
  'output.pin0.index': 0,
  'output.pin1.role': 2, // SERVO
  'output.pin2.role': 2,
  'output.pin3.role': 2,
  'output.pin4.role': 2,
  'mixer.vtail_ruddervator_gain': 1.0,
  'mixer.aileron_differential_pct': 0,
  'pid.roll.kp': 0.8,
  'pid.roll.ki': 0.05,
  'pid.roll.kd': 0.02,
  'pid.pitch.kp': 1.0,
  'pid.pitch.ki': 0.06,
  'pid.pitch.kd': 0.025,
  'safety.rth_failsafe_enabled': true,
  'telemetry.update_rate_hz': 5,
};
