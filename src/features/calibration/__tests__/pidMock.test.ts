import { afterEach, describe, expect, it } from 'vitest';
import { DeviceClientImpl } from '../../../core/device';
import { MockTransport } from '../../../core/mock';
import { useCalibrationStore } from '../calibrationStore';

/**
 * Integrasi tanpa fake tulisan tangan: store → DeviceClient → frame biner
 * asli → MockDevice. Menangkap kalau schema mock PID salah ukuran frame
 * atau encode/decode SET/GET tidak cocok.
 */
describe('kalibrasi PID terhadap MockDevice', () => {
  const client = new DeviceClientImpl();

  afterEach(async () => {
    useCalibrationStore.getState().reset();
    await client.disconnect();
  });

  it('load + apply + commit lewat wire format sungguhan', async () => {
    await client.connect(new MockTransport({ latencyMs: 0 }));
    const s = () => useCalibrationStore.getState();

    await s().load(client);
    expect(s().schemaError).toBeNull();
    expect(s().axes.roll.gains?.kp).toBeCloseTo(0.8, 5);
    expect(s().axes.pitch.gains?.kd).toBeCloseTo(0.025, 5);
    expect(s().limits['pid.roll.kd']).toMatchObject({ readonlyWhenArmed: false });

    await s().apply(client, 'roll', { kp: 1.25, ki: 0.1, kd: 0.03 });
    expect(s().axes.roll.status).toBe('applied');
    expect(s().axes.roll.gains?.kp).toBeCloseTo(1.25, 5);

    await s().commit(client);
    expect(s().commitStatus).toBe('ok');
  });
});
