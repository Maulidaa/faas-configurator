import { beforeEach, describe, expect, it } from 'vitest';
import type { DeviceClient } from '../../../core/device';
import {
  settingCommitCommand,
  settingGetCommand,
  settingSchemaListCommand,
  settingSetCommand,
} from '../../../core/commands/registry';
import type { SettingFieldSchema } from '../../../shared/types';
import { pidKey, useCalibrationStore } from '../calibrationStore';

const num = (key: string, min = 0, max = 5, step = 0.01): SettingFieldSchema => ({
  key,
  label: key,
  type: 'number',
  min,
  max,
  step,
});

const axisGroup = (axis: 'roll' | 'pitch'): SettingFieldSchema => ({
  key: `pid_${axis}`,
  label: axis,
  type: 'group',
  children: [num(`pid.${axis}.kp`), num(`pid.${axis}.ki`, 0, 2), num(`pid.${axis}.kd`, 0, 1, 0.001)],
});

/** Device tiruan: schema + nilai di RAM, dengan hook untuk menolak / meng-clamp. */
class FakeDevice {
  values: Record<string, number> = {
    'pid.roll.kp': 0.8, 'pid.roll.ki': 0.05, 'pid.roll.kd': 0.02,
    'pid.pitch.kp': 1.0, 'pid.pitch.ki': 0.06, 'pid.pitch.kd': 0.025,
  };
  schema: SettingFieldSchema[] = [axisGroup('roll'), axisGroup('pitch')];
  rejectKey: string | null = null;
  clampMax: Record<string, number> = {};
  commits = 0;
  setLog: string[] = [];

  async sendCommand(cmd: unknown, req: unknown): Promise<unknown> {
    if (cmd === settingSchemaListCommand) {
      return { pageIndex: (req as { pageIndex: number }).pageIndex, hasMore: false, fields: this.schema };
    }
    if (cmd === settingGetCommand) return this.values[(req as { key: string }).key];
    if (cmd === settingSetCommand) {
      const { key, value } = req as { key: string; value: number };
      this.setLog.push(key);
      if (key === this.rejectKey) return { ok: false };
      this.values[key] = Math.min(value, this.clampMax[key] ?? Infinity);
      return { ok: true };
    }
    if (cmd === settingCommitCommand) {
      this.commits++;
      return { ok: true };
    }
    throw new Error('command tak dikenal di fake');
  }
}

const store = () => useCalibrationStore.getState();

describe('kalibrasi PID', () => {
  let dev: FakeDevice;
  let client: DeviceClient;

  beforeEach(() => {
    store().reset();
    dev = new FakeDevice();
    client = dev as unknown as DeviceClient;
  });

  it('load: membaca limit dari schema dan gain kedua axis', async () => {
    await store().load(client);
    expect(store().axes.roll.gains).toEqual({ kp: 0.8, ki: 0.05, kd: 0.02 });
    expect(store().axes.pitch.gains).toEqual({ kp: 1.0, ki: 0.06, kd: 0.025 });
    expect(store().limits[pidKey('roll', 'kd')]).toMatchObject({ min: 0, max: 1, step: 0.001 });
    expect(store().axes.roll.status).toBe('idle');
  });

  it('axis tanpa key pid di schema → unavailable, axis lain tetap jalan', async () => {
    dev.schema = [axisGroup('roll')];
    await store().load(client);
    expect(store().axes.pitch.status).toBe('unavailable');
    expect(store().axes.roll.status).toBe('idle');
  });

  it('apply: SET tiga gain lalu tampilkan hasil readback', async () => {
    await store().load(client);
    await store().apply(client, 'roll', { kp: 1.2, ki: 0.1, kd: 0.03 });
    expect(dev.setLog).toEqual(['pid.roll.kp', 'pid.roll.ki', 'pid.roll.kd']);
    expect(store().axes.roll).toMatchObject({ status: 'applied', gains: { kp: 1.2, ki: 0.1, kd: 0.03 } });
    // axis lain tidak tersentuh
    expect(store().axes.pitch.gains).toEqual({ kp: 1.0, ki: 0.06, kd: 0.025 });
  });

  it('apply: nilai yang di-clamp device ditampilkan apa adanya (bukan yang dikirim)', async () => {
    await store().load(client);
    dev.clampMax['pid.roll.kp'] = 2;
    await store().apply(client, 'roll', { kp: 4, ki: 0.05, kd: 0.02 });
    expect(store().axes.roll.gains?.kp).toBe(2);
  });

  it('apply: ditolak di tengah → berhenti, status rejected, gain = nilai aktual', async () => {
    await store().load(client);
    dev.rejectKey = 'pid.roll.ki';
    await store().apply(client, 'roll', { kp: 1.5, ki: 0.2, kd: 0.09 });
    expect(dev.setLog).toEqual(['pid.roll.kp', 'pid.roll.ki']); // kd tidak dikirim
    expect(store().axes.roll.status).toBe('rejected');
    expect(store().axes.roll.error).toContain('KI');
    // kp sudah terlanjur berlaku, ki/kd masih lama — UI harus jujur soal itu
    expect(store().axes.roll.gains).toEqual({ kp: 1.5, ki: 0.05, kd: 0.02 });
  });

  it('commit: memanggil CMD_SETTING_COMMIT', async () => {
    await store().commit(client);
    expect(dev.commits).toBe(1);
    expect(store().commitStatus).toBe('ok');
  });
});
