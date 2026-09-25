import { useEffect, useMemo, useState } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import {
  PID_AXES,
  PID_TERMS,
  pidKey,
  useCalibrationStore,
  type AxisStatus,
  type PidAxis,
  type PidGains,
  type PidLimits,
  type PidTerm,
} from './calibrationStore';
import './CalibrationPanel.css';

const AXIS_LABEL: Record<PidAxis, string> = { roll: 'Roll', pitch: 'Pitch' };

const TERM_INFO: Record<PidTerm, { label: string; hint: string }> = {
  kp: { label: 'Kp', hint: 'Respons terhadap error sekarang. Terlalu besar → osilasi cepat.' },
  ki: { label: 'Ki', hint: 'Mengoreksi error yang bertahan (offset/trim). Terlalu besar → osilasi lambat.' },
  kd: { label: 'Kd', hint: 'Meredam perubahan cepat. Terlalu besar → getar/noise di servo.' },
};

const STATUS_LABEL: Record<AxisStatus, string> = {
  idle: 'Sinkron',
  loading: 'Membaca…',
  applying: 'Menerapkan…',
  applied: 'Diterapkan',
  rejected: 'Ditolak',
  error: 'Error',
  unavailable: 'Tidak tersedia',
};

type Draft = Record<PidTerm, string>;

/** Jumlah desimal yang cukup untuk `step` (0.001 → 3), dibatasi supaya f32 noise tidak tampil. */
function decimalsFor(step: number | undefined): number {
  if (!step || step <= 0) return 4;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

function fmt(value: number, step: number | undefined): string {
  return value.toFixed(decimalsFor(step));
}

function toDraft(gains: PidGains, limits: Record<string, PidLimits>, axis: PidAxis): Draft {
  const d = {} as Draft;
  for (const t of PID_TERMS) d[t] = fmt(gains[t], limits[pidKey(axis, t)]?.step);
  return d;
}

/** Pesan validasi untuk satu isian, atau null kalau valid. */
function validate(text: string, lim: PidLimits | undefined): string | null {
  if (text.trim() === '') return 'Wajib diisi';
  const n = Number(text);
  if (!Number.isFinite(n)) return 'Bukan angka';
  if (lim?.min !== undefined && n < lim.min) return `Minimal ${lim.min}`;
  if (lim?.max !== undefined && n > lim.max) return `Maksimal ${lim.max}`;
  return null;
}

interface AxisCardProps {
  axis: PidAxis;
  armed: boolean;
}

function AxisCard({ axis, armed }: AxisCardProps) {
  const client = useConnectionStore((s) => s.contentClient);
  const state = useCalibrationStore((s) => s.axes[axis]);
  const limits = useCalibrationStore((s) => s.limits);
  const apply = useCalibrationStore((s) => s.apply);

  const [draft, setDraft] = useState<Draft | null>(null);

  // Draft mengikuti nilai aktual device setiap kali store membaca ulang
  // (load awal, atau readback setelah apply) — buang edit yang belum diterapkan.
  useEffect(() => {
    if (state.gains) setDraft(toDraft(state.gains, limits, axis));
  }, [state.gains, limits, axis]);

  const locked = useMemo(
    () => armed && PID_TERMS.some((t) => limits[pidKey(axis, t)]?.readonlyWhenArmed),
    [armed, limits, axis],
  );

  const busy = state.status === 'applying' || state.status === 'loading';

  if (state.status === 'unavailable') {
    return (
      <div className="calib-card">
        <div className="calib-card-header">
          <h3>PID {AXIS_LABEL[axis]}</h3>
          <span className="calib-state-badge" data-state="unavailable">
            {STATUS_LABEL.unavailable}
          </span>
        </div>
        <p className="calib-description">
          Firmware belum mengekspos setting <code>pid.{axis}.kp / ki / kd</code>. Daftarkan lewat Settings_RegisterField()
          di sisi firmware, lalu muat ulang.
        </p>
      </div>
    );
  }

  if (!state.gains || !draft) {
    return (
      <div className="calib-card">
        <div className="calib-card-header">
          <h3>PID {AXIS_LABEL[axis]}</h3>
          <span className="calib-state-badge" data-state={state.status}>
            {STATUS_LABEL[state.status]}
          </span>
        </div>
        {state.error ? (
          <p className="calib-hint calib-hint-error">{state.error}</p>
        ) : (
          <p className="calib-description">Membaca gain dari device…</p>
        )}
      </div>
    );
  }

  const gains = state.gains;
  const errors = {} as Record<PidTerm, string | null>;
  const dirty = {} as Record<PidTerm, boolean>;
  for (const t of PID_TERMS) {
    const lim = limits[pidKey(axis, t)];
    errors[t] = validate(draft[t], lim);
    const step = lim?.step ?? 1e-4;
    dirty[t] = errors[t] === null && Math.abs(Number(draft[t]) - gains[t]) > step / 2;
  }
  const anyDirty = PID_TERMS.some((t) => dirty[t]);
  const anyInvalid = PID_TERMS.some((t) => errors[t] !== null);

  const onApply = () => {
    const next = {} as PidGains;
    for (const t of PID_TERMS) next[t] = Number(draft[t]);
    void apply(client, axis, next);
  };

  return (
    <div className="calib-card">
      <div className="calib-card-header">
        <h3>PID {AXIS_LABEL[axis]}</h3>
        <span className="calib-state-badge" data-state={anyDirty && state.status === 'idle' ? 'dirty' : state.status}>
          {anyDirty && (state.status === 'idle' || state.status === 'applied') ? 'Belum diterapkan' : STATUS_LABEL[state.status]}
        </span>
      </div>

      <div className="pid-rows">
        {PID_TERMS.map((t) => {
          const lim = limits[pidKey(axis, t)];
          const range =
            lim?.min !== undefined && lim?.max !== undefined ? `${lim.min} – ${lim.max}` : undefined;
          return (
            <label key={t} className="pid-row" data-dirty={dirty[t]}>
              <span className="pid-row-label">
                <strong>{TERM_INFO[t].label}</strong>
                {range && <span className="pid-row-range">{range}</span>}
              </span>
              <input
                className="pid-input mono"
                type="number"
                inputMode="decimal"
                value={draft[t]}
                min={lim?.min}
                max={lim?.max}
                step={lim?.step}
                disabled={locked || busy}
                aria-invalid={errors[t] !== null}
                onChange={(e) => setDraft({ ...draft, [t]: e.target.value })}
              />
              <span className="pid-row-device mono" title="Nilai aktif di device">
                {dirty[t] ? `device: ${fmt(gains[t], lim?.step)}` : '\u00A0'}
              </span>
              <span className="pid-row-msg">{errors[t] ?? TERM_INFO[t].hint}</span>
            </label>
          );
        })}
      </div>

      {locked && <p className="calib-hint calib-hint-warn">Gain terkunci selagi device armed — disarm dulu.</p>}
      {state.error && <p className="calib-hint calib-hint-error">{state.error}</p>}

      <div className="calib-actions">
        <button
          type="button"
          className="calib-button calib-button-ghost"
          disabled={busy || !anyDirty}
          onClick={() => setDraft(toDraft(gains, limits, axis))}
        >
          Kembalikan
        </button>
        <button
          type="button"
          className="calib-button calib-button-primary"
          disabled={busy || locked || !anyDirty || anyInvalid}
          onClick={onApply}
        >
          {state.status === 'applying' ? 'Menerapkan…' : 'Terapkan ke Device'}
        </button>
      </div>
    </div>
  );
}

/**
 * features/calibration/CalibrationPanel.tsx
 *
 * Kalibrasi PID: tuning gain Kp/Ki/Kd untuk loop roll & pitch. Semuanya lewat
 * command Settings yang sudah ada (lihat calibrationStore.ts) — panel ini
 * tidak punya command sendiri. Dua tingkat penyimpanan sengaja dipisah,
 * mengikuti tab Settings: "Terapkan" menulis ke RAM device (langsung berlaku,
 * hilang saat reboot — aman untuk coba-coba), "Commit ke Flash" baru
 * menyimpannya permanen.
 */
function CalibrationPanel() {
  const client = useConnectionStore((s) => s.contentClient);
  const connectionState = useConnectionStore((s) => s.connectionState);
  const armed = useConnectionStore((s) => s.deviceStatus?.armed ?? false);
  const ready = connectionState === 'connected';

  const load = useCalibrationStore((s) => s.load);
  const loading = useCalibrationStore((s) => s.loading);
  const schemaError = useCalibrationStore((s) => s.schemaError);
  const commitStatus = useCalibrationStore((s) => s.commitStatus);
  const commit = useCalibrationStore((s) => s.commit);

  useEffect(() => {
    if (ready) void load(client);
  }, [client, ready, load]);

  if (schemaError) {
    return (
      <div className="calibration-panel">
        <p className="calib-hint calib-hint-error">Gagal memuat skema setting dari device.</p>
        <p className="calib-description mono">{schemaError}</p>
        <div className="calib-actions">
          <button type="button" className="calib-button calib-button-ghost" onClick={() => void load(client)}>
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="calibration-panel">
      <div className="calib-intro">
        <h2>Kalibrasi PID</h2>
        <p>
          Atur gain Kp/Ki/Kd untuk loop stabilisasi roll dan pitch. &ldquo;Terapkan&rdquo; langsung berlaku di RAM device
          (hilang saat reboot), jadi aman untuk coba-coba; &ldquo;Commit ke Flash&rdquo; menyimpannya permanen. Ubah sedikit
          demi sedikit dan satu gain per percobaan.
        </p>
      </div>

      {armed && (
        <div className="calib-armed-banner">
          Device sedang <strong>ARMED</strong> — perubahan gain langsung mempengaruhi kontrol. Ubah kecil-kecil.
        </div>
      )}

      {loading && <p className="calib-description">Memuat setting dari device…</p>}

      <div className="calib-grid">
        {PID_AXES.map((axis) => (
          <AxisCard key={axis} axis={axis} armed={armed} />
        ))}
      </div>

      <div className="calib-commit-bar">
        <button
          type="button"
          className="calib-button calib-button-primary"
          disabled={commitStatus === 'committing'}
          onClick={() => void commit(client)}
        >
          {commitStatus === 'committing' ? 'Menyimpan ke flash…' : 'Commit ke Flash'}
        </button>
        <span className="calib-description">
          Menyimpan seluruh setting device (bukan hanya PID) secara permanen.
        </span>
        {commitStatus === 'ok' && <span className="calib-commit-ok">Tersimpan permanen.</span>}
        {commitStatus === 'rejected' && <span className="calib-commit-err">Ditolak device.</span>}
        {commitStatus === 'error' && <span className="calib-commit-err">Gagal commit.</span>}
      </div>
    </div>
  );
}

export default CalibrationPanel;
