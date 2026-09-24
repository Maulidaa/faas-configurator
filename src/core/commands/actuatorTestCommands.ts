import { BinaryReader, BinaryWriter } from '../../shared/utils/binary';
import { CMD_MOTOR_TEST, CMD_SERVO_TEST } from './ids';
import type { CommandDef } from './CommandDef';

export interface ActuatorTestRequest {
  /** Index logis pin (output.pin0..pinN), sesuai grup setting output_mapping — protocol.md Bagian 8. */
  outputIndex: number;
  /** Motor: throttle 0.0-1.0. Servo: posisi normalized -1.0..1.0. ASUMSI representasi. */
  value: number;
}

export interface ActuatorTestResult {
  ok: boolean;
  /** true kalau ditolak firmware karena armed=true (kedua command *_TEST armed-gated). */
  rejectedArmed: boolean;
}

/**
 * Request: [outputIndex:u8][value:f32]. Response: [status:u8] (0=ok, 1=ditolak
 * krn armed). ASUMSI — belum byte-spec'd di protocol.md, tapi status
 * armed-gated-nya sendiri SUDAH final (keputusan tim, protocol.md Bagian 5).
 */
function decodeTestResult(payload: Uint8Array): ActuatorTestResult {
  const status = new BinaryReader(payload).u8();
  return { ok: status === 0, rejectedArmed: status === 1 };
}

function encodeTestRequest({ outputIndex, value }: ActuatorTestRequest): Uint8Array {
  return new BinaryWriter().u8(outputIndex).f32(value).toUint8Array();
}

/** armed-gated: DITOLAK firmware kalau DeviceStatus.armed === true. */
export const motorTestCommand: CommandDef<ActuatorTestRequest, ActuatorTestResult> = {
  id: CMD_MOTOR_TEST,
  name: 'CMD_MOTOR_TEST',
  encodeRequest: encodeTestRequest,
  decodeResponse: decodeTestResult,
};

/**
 * armed-gated: disamakan dengan CMD_MOTOR_TEST per keputusan tim — semua
 * command *_TEST ditolak saat armed=true (protocol.md Bagian 5).
 */
export const servoTestCommand: CommandDef<ActuatorTestRequest, ActuatorTestResult> = {
  id: CMD_SERVO_TEST,
  name: 'CMD_SERVO_TEST',
  encodeRequest: encodeTestRequest,
  decodeResponse: decodeTestResult,
};
