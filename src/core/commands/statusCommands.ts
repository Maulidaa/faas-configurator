import { BinaryReader } from '../../shared/utils/binary';
import type { DeviceStatus } from '../../shared/types';
import { CMD_GET_STATUS } from './ids';
import { emptyRequest, type CommandDef } from './CommandDef';

const GPS_FIX_TYPES: DeviceStatus['gpsFixType'][] = ['no-fix', '2d', '3d'];

/**
 * ASUMSI KERJA — protocol.md Bagian 5 hanya menyebut nama field
 * (armed, firmwareVersion, protocolVersion, batteryVoltage, gpsFixType),
 * bukan layout byte persis. Layout di bawah adalah asumsi yang masuk akal
 * dan WAJIB diverifikasi byte-level terhadap firmware sebelum dipakai
 * produksi:
 *
 *   [armed: u8 (0/1)]
 *   [firmwareVersion: lstring]
 *   [protocolVersion: u8]
 *   [batteryVoltage: f32]  // volt
 *   [gpsFixType: u8]       // 0=no-fix, 1=2d, 2=3d
 */
export const getStatusCommand: CommandDef<void, DeviceStatus> = {
  id: CMD_GET_STATUS,
  name: 'CMD_GET_STATUS',
  encodeRequest: emptyRequest,
  decodeResponse(payload): DeviceStatus {
    const r = new BinaryReader(payload);
    return {
      armed: r.u8() !== 0,
      firmwareVersion: r.lstring(),
      protocolVersion: r.u8(),
      batteryVoltage: r.f32(),
      gpsFixType: GPS_FIX_TYPES[r.u8()] ?? 'no-fix',
    };
  },
};
