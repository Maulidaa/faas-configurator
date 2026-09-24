import { BinaryReader, BinaryWriter } from '../../shared/utils/binary';
import type { HomePosition, NavMode, RthTriggerResult, Waypoint, WaypointAction } from '../../shared/types';
import { CMD_HOME_SET, CMD_MISSION_UPLOAD, CMD_RTH_TRIGGER } from './ids';
import { emptyRequest, type CommandDef } from './CommandDef';

// ASUMSI urutan enum action_type — protocol.md Bagian 10 menyebut nama
// (WAYPOINT/RTH/LOITER) tapi tidak menomori urutannya secara eksplisit.
const ACTION_TYPES: WaypointAction['type'][] = ['waypoint', 'rth', 'loiter'];

function encodeAction(action: WaypointAction | undefined): { actionType: number; actionParam: number } {
  const type = action?.type ?? 'waypoint';
  const actionType = ACTION_TYPES.indexOf(type);
  // action_param berarti radius (meter) kalau action_type = LOITER, diabaikan
  // untuk WAYPOINT/RTH — protocol.md Bagian 10, eksplisit.
  const actionParam = action?.type === 'loiter' ? action.radiusM : 0;
  return { actionType, actionParam };
}

function decodeAction(actionType: number, actionParam: number): WaypointAction {
  const type = ACTION_TYPES[actionType] ?? 'waypoint';
  if (type === 'loiter') return { type: 'loiter', radiusM: actionParam };
  return { type };
}

/**
 * Satu item mission, EKSPLISIT protocol.md Bagian 10:
 *   [seq:u8][lat_e7:i32][lon_e7:i32][altitude_m:i16][action_type:u8][action_param:i32]
 */
export function encodeWaypointItem(w: BinaryWriter, wp: Waypoint): void {
  const { actionType, actionParam } = encodeAction(wp.action);
  w.u8(wp.seq).i32(wp.latE7).i32(wp.lonE7).i16(wp.altitudeM).u8(actionType).i32(actionParam);
}

export function decodeWaypointItem(r: BinaryReader): Waypoint {
  const seq = r.u8();
  const latE7 = r.i32();
  const lonE7 = r.i32();
  const altitudeM = r.i16();
  const actionType = r.u8();
  const actionParam = r.i32();
  return {
    id: `wp-${seq}`,
    seq,
    latE7,
    lonE7,
    altitudeM,
    action: decodeAction(actionType, actionParam),
  };
}

export interface MissionUploadChunkRequest {
  totalChunks: number;
  chunkIndex: number;
  items: Waypoint[];
}

export type ChunkAckStatus = 'ok' | 'retry';

export interface MissionUploadChunkResult {
  chunkIndex: number;
  status: ChunkAckStatus;
}

/**
 * Satu chunk dari CMD_MISSION_UPLOAD. Pemecahan waypoint[] jadi banyak chunk
 * + retry-on-loss ditangani oleh sendChunkedCommand di core/device/ (Bagian
 * 6.1 web-doc) — features/mission tidak pernah memanggil CommandDef ini
 * langsung.
 *
 * Request, EKSPLISIT protocol.md Bagian 6:
 *   [total_chunks:u8][chunk_index:u8][item_count:u8][item...]
 * Response, EKSPLISIT protocol.md Bagian 6:
 *   [chunk_index:u8][status:u8 (0=OK, 1=RETRY)]
 */
export const missionUploadChunkCommand: CommandDef<MissionUploadChunkRequest, MissionUploadChunkResult> = {
  id: CMD_MISSION_UPLOAD,
  name: 'CMD_MISSION_UPLOAD',
  encodeRequest({ totalChunks, chunkIndex, items }) {
    const w = new BinaryWriter().u8(totalChunks).u8(chunkIndex).u8(items.length);
    for (const item of items) encodeWaypointItem(w, item);
    return w.toUint8Array();
  },
  decodeResponse(payload): MissionUploadChunkResult {
    const r = new BinaryReader(payload);
    const chunkIndex = r.u8();
    const status: ChunkAckStatus = r.u8() === 0 ? 'ok' : 'retry';
    return { chunkIndex, status };
  },
};

/** EKSPLISIT protocol.md Bagian 10: [lat_e7:i32][lon_e7:i32][altitude_m:i32] */
export const homeSetCommand: CommandDef<HomePosition, void> = {
  id: CMD_HOME_SET,
  name: 'CMD_HOME_SET',
  encodeRequest({ latE7, lonE7, altitudeM }) {
    return new BinaryWriter().i32(latE7).i32(lonE7).i32(altitudeM).toUint8Array();
  },
  decodeResponse() {
    // Tidak ada payload respons yang perlu di-decode.
  },
};

// Urutan EKSPLISIT dari enum NAV_Mode_t firmware (navigation.h) — indeksnya
// dikirim mentah sebagai byte kedua respons CMD_RTH_TRIGGER. JANGAN diubah
// urutannya tanpa cek ulang enum firmware (audit: navigation.h baris ~99).
const NAV_MODES: NavMode[] = ['idle', 'altitude-hold', 'waypoint', 'rth', 'rth-no-gps-fallback'];

function decodeNavMode(raw: number): NavMode {
  return NAV_MODES[raw] ?? 'idle';
}

/**
 * BARU — ditemukan dari audit kode firmware (navigation.c, handle_rth_trigger),
 * belum ada di draft protocol.md sebelumnya sampai Bagian 5 & 10 diupdate.
 * Payload request kosong. TIDAK armed-gated (RTH manual dari web adalah
 * perintah darurat, sengaja tetap diterima saat armed=true — komentar
 * firmware eksplisit soal ini).
 *
 * Respons: [status:u8 (selalu 0 di firmware saat ini — command ini tidak
 * pernah ditolak)][nav_mode:u8]. `nav_mode` mencerminkan mode SETELAH
 * Nav_TriggerRTH() dipanggil — 'rth' kalau GPS fix tersedia saat dipicu,
 * 'rth-no-gps-fallback' kalau tidak (Nav_TriggerRTH() sendiri yang memilih).
 */
export const rthTriggerCommand: CommandDef<void, RthTriggerResult> = {
  id: CMD_RTH_TRIGGER,
  name: 'CMD_RTH_TRIGGER',
  encodeRequest: emptyRequest,
  decodeResponse(payload): RthTriggerResult {
    const r = new BinaryReader(payload);
    const status = r.u8();
    const navMode = decodeNavMode(r.u8());
    return { ok: status === 0, navMode };
  },
};
