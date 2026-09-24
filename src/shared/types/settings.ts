/**
 * Setting schema types. Frozen per web-configurator-architecture.md Bagian 4.5.
 * Wire encoding for these is defined in docs/protocol.md Bagian 7 — encode/decode
 * lives in core/commands/settingCommands.ts, this file only holds the shape.
 */

export type SettingFieldType =
  | 'number'
  | 'bool'
  | 'enum'
  | 'string'
  | 'bitmask'
  | 'group';

export interface SettingEnumOption {
  value: number;
  label: string;
}

export interface SettingBitmaskFlag {
  bit: number;
  label: string;
}

export interface SettingFieldSchema {
  key: string;
  label: string;
  type: SettingFieldType;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  enumOptions?: SettingEnumOption[];
  bitmaskFlags?: SettingBitmaskFlag[];
  children?: SettingFieldSchema[]; // hanya untuk type: 'group'
  /**
   * Wajib true untuk seluruh grup output_mapping & mixer, plus toggle
   * fitur keselamatan (RTH/failsafe enable) — protocol.md Bagian 7.
   */
  readonlyWhenArmed?: boolean;
}

/** Nilai setting saat ini, keyed by SettingFieldSchema.key (hanya leaf field). */
export type SettingValue = number | boolean | string;
export type SettingValues = Record<string, SettingValue>;
