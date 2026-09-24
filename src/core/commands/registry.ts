/**
 * core/commands/registry.ts
 * Satu objek gabungan dari semua CommandDef (web-configurator-architecture.md
 * Bagian 7). Fitur hanya boleh import dari sini, tidak langsung dari
 * file grup individual — supaya titik masuk tetap satu tempat kalau nanti
 * command baru ditambah atau namanya berubah.
 */
export * from './CommandDef';
export * from './ids';

export { getStatusCommand } from './statusCommands';
export { attitudeCommand, batteryCommand, gpsDataCommand, imuRawCommand } from './telemetryCommands';
export {
  settingSchemaListCommand,
  settingGetCommand,
  settingSetCommand,
  settingCommitCommand,
  type SchemaListPage,
  type SettingGetRequest,
  type SettingSetRequest,
  type SettingSetResult,
} from './settingCommands';
export {
  motorTestCommand,
  servoTestCommand,
  type ActuatorTestRequest,
  type ActuatorTestResult,
} from './actuatorTestCommands';
export {
  missionUploadChunkCommand,
  homeSetCommand,
  rthTriggerCommand,
  encodeWaypointItem,
  decodeWaypointItem,
  type MissionUploadChunkRequest,
  type MissionUploadChunkResult,
  type ChunkAckStatus,
} from './missionCommands';
export { rebootDfuCommand, flashHashCommand, type FlashHashRequest } from './dfuCommands';
export { decodeErrorFrame, DeviceError, type DeviceErrorPayload } from './errorFrame';

import { getStatusCommand } from './statusCommands';
import { attitudeCommand, batteryCommand, gpsDataCommand, imuRawCommand } from './telemetryCommands';
import {
  settingSchemaListCommand,
  settingGetCommand,
  settingSetCommand,
  settingCommitCommand,
} from './settingCommands';
import { motorTestCommand, servoTestCommand } from './actuatorTestCommands';
import { missionUploadChunkCommand, homeSetCommand, rthTriggerCommand } from './missionCommands';
import { rebootDfuCommand, flashHashCommand } from './dfuCommands';

/** Objek gabungan — satu-satunya pintu masuk command untuk core/device dan features/*. */
export const commandRegistry = {
  getStatus: getStatusCommand,
  attitude: attitudeCommand,
  gpsData: gpsDataCommand,
  battery: batteryCommand,
  imuRaw: imuRawCommand,
  settingSchemaList: settingSchemaListCommand,
  settingGet: settingGetCommand,
  settingSet: settingSetCommand,
  settingCommit: settingCommitCommand,
  motorTest: motorTestCommand,
  servoTest: servoTestCommand,
  missionUploadChunk: missionUploadChunkCommand,
  homeSet: homeSetCommand,
  rthTrigger: rthTriggerCommand,
  rebootDfu: rebootDfuCommand,
  flashHash: flashHashCommand,
} as const;
