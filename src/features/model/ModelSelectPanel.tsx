import { useModelStore } from '../../store/modelStore';
import './ModelSelectPanel.css';

/**
 * features/model/ModelSelectPanel.tsx
 * Layar paling depan aplikasi — App.tsx merender ini SEBELUM ConnectionPanel
 * maupun tab-strip (Settings/PID-tuning/Mission/DFU/Log). User wajib memilih
 * jenis airframe dulu, baru lanjut ke alur koneksi device dan tuning.
 *
 * Firmware v1 (lihat modelStore.ts) hanya punya skema mixer untuk V-tail,
 * jadi opsi Quadcopter ditampilkan sebagai referensi jenis yang direncanakan
 * tapi non-interaktif ("N/A") — bukan disembunyikan sama sekali, supaya user
 * tahu jenis itu ada di roadmap, bukan sekadar hilang tanpa penjelasan.
 */

function IconVtailPlane() {
  return (
    <svg className="model-option-icon" viewBox="0 0 120 130" aria-hidden="true">
      {/* motor/baling-baling di hidung */}
      <circle cx="60" cy="14" r="5" fill="currentColor" />
      {/* fuselage */}
      <path d="M60 19 57 40 57 88 60 100 63 88 63 40Z" fill="currentColor" />
      {/* sayap utama (aileron kiri-kanan) */}
      <path d="M14 58 58 44 62 44 106 58 98 68 62 54 58 54 22 68Z" fill="currentColor" />
      {/* ekor V (ruddervator kiri-kanan) */}
      <path d="M58 92 34 118 44 120 60 98Z" fill="currentColor" />
      <path d="M62 92 86 118 76 120 60 98Z" fill="currentColor" />
    </svg>
  );
}

function IconQuadcopter() {
  return (
    <svg className="model-option-icon" viewBox="0 0 120 130" fill="none" aria-hidden="true">
      <path
        d="M60 65 30 35M60 65 90 35M60 65 30 95M60 65 90 95"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect x="50" y="55" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="4" />
      <circle cx="30" cy="35" r="13" stroke="currentColor" strokeWidth="4" />
      <circle cx="90" cy="35" r="13" stroke="currentColor" strokeWidth="4" />
      <circle cx="30" cy="95" r="13" stroke="currentColor" strokeWidth="4" />
      <circle cx="90" cy="95" r="13" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}

function ModelSelectPanel() {
  const selectModel = useModelStore((s) => s.selectModel);

  return (
    <div className="model-select-panel">
      <div className="model-select-card">
        <h2>Pilih Jenis Airframe</h2>
        <p className="model-select-lead">
          Tentukan jenis pesawat yang dipakai sebelum lanjut ke koneksi device dan tuning — pilihan ini menentukan
          skema mixer yang berlaku.
        </p>

        <div className="model-options">
          <button type="button" className="model-option" onClick={() => selectModel('vtail')}>
            <span className="model-option-badge model-option-badge-ok">Tersedia</span>
            <IconVtailPlane />
            <span className="model-option-title">Fixed-Wing V-Tail</span>
            <span className="model-option-desc">1 motor + 2 aileron + 2 ruddervator</span>
          </button>

          <div className="model-option model-option-disabled" aria-disabled="true">
            <span className="model-option-badge model-option-badge-na">N/A</span>
            <IconQuadcopter />
            <span className="model-option-title">Quadcopter</span>
            <span className="model-option-desc">Belum didukung firmware</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ModelSelectPanel;
