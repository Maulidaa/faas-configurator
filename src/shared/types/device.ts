/**
 * Cross-module device types. Frozen per web-configurator-architecture.md Bagian 4.5.
 * Do not import feature-specific types here — this file is imported by both
 * core/ and features/*, so it must stay dependency-free.
 */

export interface DeviceStatus {
  armed: boolean;
  firmwareVersion: string;
  protocolVersion: number;
  batteryVoltage: number;
  gpsFixType: 'no-fix' | '2d' | '3d';
}

export type ImuFlag = 'primary' | 'secondary';

export interface AttitudeData {
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  activeImu: ImuFlag;
}

export interface GpsData {
  latE7: number;
  lonE7: number;
  groundSpeedCms: number;
  fixType: DeviceStatus['gpsFixType'];
  satCount: number;
}

export interface BatteryData {
  voltageMv: number;
  currentMa: number;
}

export interface ImuRawSample {
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
}

export interface ImuRawData {
  primary: ImuRawSample;
  secondary: ImuRawSample;
}
