import { BinaryReader } from '../../shared/utils/binary';
import type { AttitudeData, BatteryData, GpsData, ImuRawData, ImuRawSample } from '../../shared/types';
import { CMD_ATTITUDE, CMD_BATTERY, CMD_GPS_DATA, CMD_IMU_RAW } from './ids';
import { emptyRequest, type CommandDef } from './CommandDef';

const GPS_FIX_TYPES: GpsData['fixType'][] = ['no-fix', '2d', '3d'];
const IMU_FLAGS: AttitudeData['activeImu'][] = ['primary', 'secondary'];

/**
 * ASUMSI KERJA (belum eksplisit protocol.md, hanya nama field disebut):
 *   [rollDeg: f32][pitchDeg: f32][yawDeg: f32][activeImu: u8 (0=primary,1=secondary)]
 * Semua command telemetri ini FC→web murni — request kosong dipakai kalau
 * web polling manual; firmware juga boleh mengirim ini unsolicited
 * (request_id = 0x00), lihat DeviceClient 'unsolicited' event.
 */
export const attitudeCommand: CommandDef<void, AttitudeData> = {
  id: CMD_ATTITUDE,
  name: 'CMD_ATTITUDE',
  encodeRequest: emptyRequest,
  decodeResponse(payload): AttitudeData {
    const r = new BinaryReader(payload);
    return {
      rollDeg: r.f32(),
      pitchDeg: r.f32(),
      yawDeg: r.f32(),
      activeImu: IMU_FLAGS[r.u8()] ?? 'primary',
    };
  },
};

/** ASUMSI KERJA: [latE7: i32][lonE7: i32][groundSpeedCms: u16][fixType: u8][satCount: u8] */
export const gpsDataCommand: CommandDef<void, GpsData> = {
  id: CMD_GPS_DATA,
  name: 'CMD_GPS_DATA',
  encodeRequest: emptyRequest,
  decodeResponse(payload): GpsData {
    const r = new BinaryReader(payload);
    return {
      latE7: r.i32(),
      lonE7: r.i32(),
      groundSpeedCms: r.u16(),
      fixType: GPS_FIX_TYPES[r.u8()] ?? 'no-fix',
      satCount: r.u8(),
    };
  },
};

/** ASUMSI KERJA: [voltageMv: u16][currentMa: u16] */
export const batteryCommand: CommandDef<void, BatteryData> = {
  id: CMD_BATTERY,
  name: 'CMD_BATTERY',
  encodeRequest: emptyRequest,
  decodeResponse(payload): BatteryData {
    const r = new BinaryReader(payload);
    return { voltageMv: r.u16(), currentMa: r.u16() };
  },
};

function readImuSample(r: BinaryReader): ImuRawSample {
  return {
    accelX: r.i16(),
    accelY: r.i16(),
    accelZ: r.i16(),
    gyroX: r.i16(),
    gyroY: r.i16(),
    gyroZ: r.i16(),
  };
}

/**
 * ASUMSI KERJA: primary lalu secondary, masing-masing 6x i16
 * (accelX/Y/Z, gyroX/Y/Z) raw counts — untuk debug/kalibrasi dual-IMU.
 */
export const imuRawCommand: CommandDef<void, ImuRawData> = {
  id: CMD_IMU_RAW,
  name: 'CMD_IMU_RAW',
  encodeRequest: emptyRequest,
  decodeResponse(payload): ImuRawData {
    const r = new BinaryReader(payload);
    const primary = readImuSample(r);
    const secondary = readImuSample(r);
    return { primary, secondary };
  },
};
