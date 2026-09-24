import { BinaryReader, BinaryWriter } from '../../shared/utils/binary';
import type {
  SettingBitmaskFlag,
  SettingEnumOption,
  SettingFieldSchema,
  SettingFieldType,
  SettingValue,
} from '../../shared/types';
import { CMD_SETTING_COMMIT, CMD_SETTING_GET, CMD_SETTING_SCHEMA_LIST, CMD_SETTING_SET } from './ids';
import type { CommandDef } from './CommandDef';

const FIELD_TYPES: SettingFieldType[] = ['number', 'bool', 'enum', 'string', 'bitmask', 'group'];

/**
 * Decode satu SettingFieldSchema sesuai wire encoding FINAL protocol.md
 * Bagian 7 (ini SATU-SATUNYA bagian command file ini yang bukan asumsi):
 *
 *   [key_len:u8][key][label_len:u8][label][type:u8][flags:u8]
 *   [min:f32][max:f32][step:f32]        // hanya kalau flags.bit0=1
 *   [unit_len:u8][unit]
 *   [option_count:u8][(value:i32)(label_len:u8)(label)...]  // enum/bitmask
 *   [child_count:u8][field...]                              // group, rekursif
 *
 * CATATAN IMPLEMENTASI (asumsi, karena protocol.md tidak eksplisit soal
 * kondisionalitas urutan byte): min/max/step dianggap BENAR-BENAR TIDAK ADA
 * di stream kalau flags.bit0=0 (bukan zero-padded), sedangkan option_count
 * dan child_count dianggap SELALU ada di stream (bernilai 0 kalau tidak
 * relevan untuk type tsb) supaya parser tidak perlu percabangan per-type
 * untuk dua field ini. `description` tidak ada di wire encoding sama sekali
 * (metadata UI-only) — selalu undefined hasil decode dari device asli.
 */
function decodeField(r: BinaryReader): SettingFieldSchema {
  const key = r.lstring();
  const label = r.lstring();
  const type = FIELD_TYPES[r.u8()] ?? 'string';
  const flags = r.u8();
  const hasMinMaxStep = (flags & 0b01) !== 0;
  const readonlyWhenArmed = (flags & 0b10) !== 0;

  let min: number | undefined;
  let max: number | undefined;
  let step: number | undefined;
  if (hasMinMaxStep) {
    min = r.f32();
    max = r.f32();
    step = r.f32();
  }

  const unit = r.lstring();

  const optionCount = r.u8();
  let enumOptions: SettingEnumOption[] | undefined;
  let bitmaskFlags: SettingBitmaskFlag[] | undefined;
  if (optionCount > 0) {
    if (type === 'bitmask') {
      bitmaskFlags = [];
      for (let i = 0; i < optionCount; i++) {
        const value = r.i32();
        const optLabel = r.lstring();
        bitmaskFlags.push({ bit: value, label: optLabel });
      }
    } else {
      enumOptions = [];
      for (let i = 0; i < optionCount; i++) {
        const value = r.i32();
        const optLabel = r.lstring();
        enumOptions.push({ value, label: optLabel });
      }
    }
  }

  const childCount = r.u8();
  let children: SettingFieldSchema[] | undefined;
  if (childCount > 0) {
    children = [];
    for (let i = 0; i < childCount; i++) children.push(decodeField(r));
  }

  return {
    key,
    label,
    type,
    unit: unit || undefined,
    min,
    max,
    step,
    enumOptions,
    bitmaskFlags,
    children,
    readonlyWhenArmed,
  };
}

export interface SchemaListPage {
  pageIndex: number;
  hasMore: boolean;
  fields: SettingFieldSchema[];
}

/**
 * Request payload ASUMSI: [page_index: u8] — protocol.md Bagian 6 hanya
 * menjelaskan perilaku client ("kirim request page berikutnya dengan
 * request_id baru tiap kali"), tidak menyebut apakah page_index perlu
 * dikirim eksplisit di request atau firmware self-track. Mengirim
 * page_index eksplisit lebih aman terhadap request yang hilang/di-retry.
 * Dipakai lewat helper sendPaginatedCommand di core/device/, fitur
 * (features/settings) tidak pernah memanggil ini langsung.
 */
export const settingSchemaListCommand: CommandDef<{ pageIndex: number }, SchemaListPage> = {
  id: CMD_SETTING_SCHEMA_LIST,
  name: 'CMD_SETTING_SCHEMA_LIST',
  encodeRequest({ pageIndex }) {
    return new BinaryWriter().u8(pageIndex).toUint8Array();
  },
  decodeResponse(payload): SchemaListPage {
    const r = new BinaryReader(payload);
    const pageIndex = r.u8();
    const hasMore = r.u8() !== 0;
    const fieldCount = r.u8();
    const fields: SettingFieldSchema[] = [];
    for (let i = 0; i < fieldCount; i++) fields.push(decodeField(r));
    return { pageIndex, hasMore, fields };
  },
};

/**
 * ASUMSI KERJA untuk GET/SET/COMMIT (protocol.md belum spesifikasi byte-level
 * untuk ketiganya) — value ditag dengan `type` di wire supaya decoder tidak
 * perlu tahu schema untuk decode response:
 *   number → f32, bool → u8, enum → i32, bitmask → u32, string → lstring
 */
function encodeTaggedValue(w: BinaryWriter, type: SettingFieldType, value: SettingValue): void {
  switch (type) {
    case 'number':
      w.u8(0).f32(value as number);
      break;
    case 'bool':
      w.u8(1).u8(value ? 1 : 0);
      break;
    case 'enum':
      w.u8(2).i32(value as number);
      break;
    case 'string':
      w.u8(3).lstring(value as string);
      break;
    case 'bitmask':
      w.u8(4).u32(value as number);
      break;
    default:
      throw new Error(`tipe setting "${type}" tidak punya representasi value tunggal`);
  }
}

function decodeTaggedValue(r: BinaryReader): SettingValue {
  const tag = r.u8();
  switch (tag) {
    case 0:
      return r.f32();
    case 1:
      return r.u8() !== 0;
    case 2:
      return r.i32();
    case 3:
      return r.lstring();
    case 4:
      return r.u32();
    default:
      throw new Error(`tag value setting tidak dikenal: ${tag}`);
  }
}

export interface SettingGetRequest {
  key: string;
}

/** Request: [key_len:u8][key]. Response: [type:u8][value] (tagged). ASUMSI. */
export const settingGetCommand: CommandDef<SettingGetRequest, SettingValue> = {
  id: CMD_SETTING_GET,
  name: 'CMD_SETTING_GET',
  encodeRequest({ key }) {
    return new BinaryWriter().lstring(key).toUint8Array();
  },
  decodeResponse(payload): SettingValue {
    return decodeTaggedValue(new BinaryReader(payload));
  },
};

export interface SettingSetRequest {
  key: string;
  type: SettingFieldType;
  value: SettingValue;
}

export interface SettingSetResult {
  ok: boolean;
}

/**
 * Request: [key_len:u8][key][type:u8][value] (tagged). Response: [status:u8]
 * (0=ok, 1=ditolak — mis. readonlyWhenArmed & device sedang armed). ASUMSI.
 */
export const settingSetCommand: CommandDef<SettingSetRequest, SettingSetResult> = {
  id: CMD_SETTING_SET,
  name: 'CMD_SETTING_SET',
  encodeRequest({ key, type, value }) {
    const w = new BinaryWriter().lstring(key);
    encodeTaggedValue(w, type, value);
    return w.toUint8Array();
  },
  decodeResponse(payload): SettingSetResult {
    return { ok: new BinaryReader(payload).u8() === 0 };
  },
};

/**
 * Commit seluruh draft perubahan (hasil SET yang masih di RAM) permanen ke
 * flash. Request kosong (commit semua, bukan per-key) — mencerminkan
 * pemisahan "Apply" (SET) vs "Commit to Flash" (COMMIT) di UI
 * (web-configurator-architecture.md Bagian 12 poin 4). Response: [status:u8].
 * ASUMSI.
 */
export const settingCommitCommand: CommandDef<void, SettingSetResult> = {
  id: CMD_SETTING_COMMIT,
  name: 'CMD_SETTING_COMMIT',
  encodeRequest: () => new Uint8Array(0),
  decodeResponse(payload): SettingSetResult {
    return { ok: new BinaryReader(payload).u8() === 0 };
  },
};
