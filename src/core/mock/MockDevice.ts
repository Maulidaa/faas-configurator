import { BinaryWriter } from '../../shared/utils/binary';
import type { DeviceStatus, SettingFieldSchema, SettingValue } from '../../shared/types';
import * as ids from '../commands/ids';
import { CMD_ERROR, MAX_PAYLOAD_SIZE } from '../protocol/constants';
import { encodeFrame, type Frame } from '../protocol/frame';
import { decodeWaypointItem } from '../commands/missionCommands';
import { MOCK_DEFAULT_VALUES, MOCK_SCHEMA_FIELDS, MOCK_SCHEMA_FLAT } from './mockSchema';
import { BinaryReader } from '../../shared/utils/binary';

const FIELD_TYPE_INDEX: Record<SettingFieldSchema['type'], number> = {
  number: 0,
  bool: 1,
  enum: 2,
  string: 3,
  bitmask: 4,
  group: 5,
};

function encodeField(w: BinaryWriter, field: SettingFieldSchema): void {
  w.lstring(field.key).lstring(field.label).u8(FIELD_TYPE_INDEX[field.type]);

  const hasMinMaxStep = field.min !== undefined || field.max !== undefined || field.step !== undefined;
  const flags = (hasMinMaxStep ? 0b01 : 0) | (field.readonlyWhenArmed ? 0b10 : 0);
  w.u8(flags);
  if (hasMinMaxStep) {
    w.f32(field.min ?? 0).f32(field.max ?? 0).f32(field.step ?? 0);
  }

  w.lstring(field.unit ?? '');

  if (field.type === 'bitmask' && field.bitmaskFlags) {
    w.u8(field.bitmaskFlags.length);
    for (const flag of field.bitmaskFlags) w.i32(flag.bit).lstring(flag.label);
  } else if (field.enumOptions) {
    w.u8(field.enumOptions.length);
    for (const opt of field.enumOptions) w.i32(opt.value).lstring(opt.label);
  } else {
    w.u8(0);
  }

  if (field.type === 'group' && field.children) {
    w.u8(field.children.length);
    for (const child of field.children) encodeField(w, child);
  } else {
    w.u8(0);
  }
}

/** Byte encoded satu field top-level (dengan semua children-nya), lewat encoder asli — satu sumber kebenaran, bukan dihitung ulang manual. */
function fieldByteSize(field: SettingFieldSchema): number {
  const w = new BinaryWriter();
  encodeField(w, field);
  return w.length;
}

/** [page_index:u8][has_more:u8][field_count:u8] — overhead di luar field-field itu sendiri. */
const PAGE_HEADER_BYTES = 3;
const PAGE_BUDGET_BYTES = MAX_PAYLOAD_SIZE - PAGE_HEADER_BYTES;

/**
 * Bin-packing greedy: masukkan field satu-satu ke page berjalan, begitu
 * nambah field berikutnya bikin page lewat PAGE_BUDGET_BYTES, tutup page
 * ini dan mulai page baru. Menggantikan array page yang dulu ditulis
 * manual (`MOCK_SCHEMA_PAGES`) — sengaja dihitung ulang tiap kali dipanggil
 * (bukan dicache di top-level module) supaya MOCK_SCHEMA_FIELDS bisa
 * diedit tanpa perlu inget nge-invalidate cache di tempat lain.
 *
 * Satu top-level field yang SENDIRIAN sudah > budget tidak mungkin
 * dipecah (protocol.md Bagian 6: pagination hanya memecah antar-field,
 * bukan di dalam satu field/grup) — dilempar sebagai error eksplisit
 * saat dev supaya ketahuan dari awal, bukan diam-diam jadi CMD_ERROR
 * samar seperti sebelumnya.
 */
function buildSchemaPages(fields: SettingFieldSchema[]): SettingFieldSchema[][] {
  const pages: SettingFieldSchema[][] = [];
  let current: SettingFieldSchema[] = [];
  let currentSize = 0;

  for (const field of fields) {
    const size = fieldByteSize(field);
    if (size > PAGE_BUDGET_BYTES) {
      throw new Error(
        `mock: field "${field.key}" sendirian ${size} byte, melebihi budget per-page (${PAGE_BUDGET_BYTES}) ` +
          `— pecah field ini jadi beberapa grup lebih kecil di mockSchema.ts, bukan andalkan pagination.`,
      );
    }
    if (current.length > 0 && currentSize + size > PAGE_BUDGET_BYTES) {
      pages.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(field);
    currentSize += size;
  }
  if (current.length > 0) pages.push(current);

  return pages;
}

function encodeTaggedValue(w: BinaryWriter, type: SettingFieldSchema['type'], value: SettingValue): void {
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
      throw new Error(`mock: tipe "${type}" tidak punya value tunggal`);
  }
}

export interface MockDeviceOptions {
  firmwareVersion?: string;
  protocolVersion?: number;
}

/**
 * core/mock/MockDevice.ts
 * Simulasi firmware di sisi browser — dikonsumsi lewat MockTransport supaya
 * DeviceClient & fitur bisa dites tanpa USB nyata (architecture Bagian 14).
 * State (armed, nilai setting) bisa dimanipulasi manual
 * lewat method publik untuk skenario testing (mis. toggle armed lalu cek
 * guard readonlyWhenArmed di UI).
 */
export class MockDevice {
  armed = false;
  batteryVoltage = 12.4; // volt, 3S default
  gpsFixType: DeviceStatus['gpsFixType'] = '3d';
  private firmwareVersion: string;
  private protocolVersion: number;
  private settingValues: Record<string, SettingValue> = { ...MOCK_DEFAULT_VALUES };

  constructor(opts: MockDeviceOptions = {}) {
    this.firmwareVersion = opts.firmwareVersion ?? '0.1.0-mock';
    this.protocolVersion = opts.protocolVersion ?? 1;
  }

  /** Balas satu frame request. Mengembalikan array supaya bisa dipakai untuk kasus multi-respons di masa depan. */
  handleRequest(frame: Frame): Uint8Array[] {
    try {
      const payload = this.dispatch(frame);
      return [encodeFrame({ commandId: frame.commandId, requestId: frame.requestId, payload })];
    } catch (err) {
      return [this.encodeError(frame, err instanceof Error ? err.message : String(err))];
    }
  }

  private encodeError(frame: Frame, message: string): Uint8Array {
    const w = new BinaryWriter().u16(frame.commandId).u8(1).lstring(message);
    return encodeFrame({ commandId: CMD_ERROR, requestId: frame.requestId, payload: w.toUint8Array() });
  }

  /** Frame unsolicited (request_id=0x00) untuk simulasi telemetry push berkala. */
  encodeUnsolicitedAttitude(): Uint8Array {
    const t = Date.now() / 1000;
    const w = new BinaryWriter()
      .f32(Math.sin(t) * 15) // roll
      .f32(Math.cos(t * 0.7) * 10) // pitch
      .f32((t * 20) % 360) // yaw
      .u8(0); // primary IMU
    return encodeFrame({ commandId: ids.CMD_ATTITUDE, requestId: 0, payload: w.toUint8Array() });
  }

  private dispatch(frame: Frame): Uint8Array {
    switch (frame.commandId) {
      case ids.CMD_GET_STATUS:
        return this.encodeStatus();
      case ids.CMD_SETTING_SCHEMA_LIST:
        return this.encodeSchemaPage(frame.payload);
      case ids.CMD_SETTING_GET:
        return this.encodeSettingGet(frame.payload);
      case ids.CMD_SETTING_SET:
        return this.encodeSettingSet(frame.payload);
      case ids.CMD_SETTING_COMMIT:
        return new BinaryWriter().u8(0).toUint8Array();
      case ids.CMD_MOTOR_TEST:
      case ids.CMD_SERVO_TEST:
        return this.encodeActuatorTest();
      case ids.CMD_MISSION_UPLOAD:
        return this.encodeMissionAck(frame.payload);
      case ids.CMD_HOME_SET:
        return new Uint8Array(0);
      case ids.CMD_RTH_TRIGGER:
        return this.encodeRthTrigger();
      case ids.CMD_REBOOT_DFU:
        if (this.armed) throw new Error('CMD_REBOOT_DFU ditolak: device armed');
        return new Uint8Array(0);
      case ids.CMD_FLASH_HASH:
        return this.encodeFlashHash(frame.payload);
      default:
        throw new Error(`command 0x${frame.commandId.toString(16)} tidak dikenal mock`);
    }
  }

  private encodeStatus(): Uint8Array {
    const fixIndex = { 'no-fix': 0, '2d': 1, '3d': 2 }[this.gpsFixType];
    return new BinaryWriter()
      .u8(this.armed ? 1 : 0)
      .lstring(this.firmwareVersion)
      .u8(this.protocolVersion)
      .f32(this.batteryVoltage)
      .u8(fixIndex)
      .toUint8Array();
  }

  private encodeSchemaPage(reqPayload: Uint8Array): Uint8Array {
    const pageIndex = reqPayload.length > 0 ? new BinaryReader(reqPayload).u8() : 0;
    const pages = buildSchemaPages(MOCK_SCHEMA_FIELDS);
    const fields = pages[pageIndex] ?? [];
    const hasMore = pageIndex < pages.length - 1;
    const w = new BinaryWriter().u8(pageIndex).u8(hasMore ? 1 : 0).u8(fields.length);
    for (const field of fields) encodeField(w, field);
    return w.toUint8Array();
  }

  private encodeSettingGet(reqPayload: Uint8Array): Uint8Array {
    const key = new BinaryReader(reqPayload).lstring();
    const field = MOCK_SCHEMA_FLAT.get(key);
    if (!field) throw new Error(`setting key tidak dikenal: ${key}`);
    const value = this.settingValues[key];
    const w = new BinaryWriter();
    encodeTaggedValue(w, field.type, value);
    return w.toUint8Array();
  }

  private encodeSettingSet(reqPayload: Uint8Array): Uint8Array {
    const r = new BinaryReader(reqPayload);
    const key = r.lstring();
    const field = MOCK_SCHEMA_FLAT.get(key);
    if (!field) throw new Error(`setting key tidak dikenal: ${key}`);

    // baca tagged value sesuai tag yang datang, bukan sesuai field.type,
    // supaya tetap bisa mendeteksi mismatch kalau ada.
    const tag = r.u8();
    let value: SettingValue;
    switch (tag) {
      case 0: value = r.f32(); break;
      case 1: value = r.u8() !== 0; break;
      case 2: value = r.i32(); break;
      case 3: value = r.lstring(); break;
      case 4: value = r.u32(); break;
      default: throw new Error(`tag value tidak dikenal: ${tag}`);
    }

    if (field.readonlyWhenArmed && this.armed) {
      return new BinaryWriter().u8(1).toUint8Array(); // rejected
    }
    this.settingValues[key] = value;
    return new BinaryWriter().u8(0).toUint8Array();
  }

  private encodeActuatorTest(): Uint8Array {
    return new BinaryWriter().u8(this.armed ? 1 : 0).toUint8Array();
  }

  /**
   * Meniru Nav_TriggerRTH() firmware (navigation.c): pilih RTH biasa (index 3,
   * NAV_MODE_RTH) kalau ada GPS fix, fallback (index 4, NAV_MODE_RTH_NO_GPS_FALLBACK)
   * kalau tidak — index HARUS sinkron dengan array NAV_MODES di missionCommands.ts.
   * status selalu 0 (command ini tidak pernah ditolak firmware, lihat handle_rth_trigger).
   */
  private encodeRthTrigger(): Uint8Array {
    const navModeIndex = this.gpsFixType === 'no-fix' ? 4 : 3;
    return new BinaryWriter().u8(0).u8(navModeIndex).toUint8Array();
  }

  private encodeMissionAck(reqPayload: Uint8Array): Uint8Array {
    const r = new BinaryReader(reqPayload);
    r.u8(); // total_chunks, tidak dipakai mock
    const chunkIndex = r.u8();
    const itemCount = r.u8();
    for (let i = 0; i < itemCount; i++) decodeWaypointItem(r); // validasi bisa di-decode
    return new BinaryWriter().u8(chunkIndex).u8(0).toUint8Array(); // selalu OK di mock
  }

  private encodeFlashHash(reqPayload: Uint8Array): Uint8Array {
    const r = new BinaryReader(reqPayload);
    const startAddress = r.u32();
    const length = r.u32();
    const fakeCrc = (startAddress ^ length ^ 0xdeadbeef) >>> 0;
    return new BinaryWriter().u32(fakeCrc).toUint8Array();
  }
}