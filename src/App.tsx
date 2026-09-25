import { useEffect, useRef, useState } from 'react';
import { useConnectionStore } from './store/connectionStore';
import { useModelStore } from './store/modelStore';
import { ConnectionPanel } from './features/connection';
import { ModelSelectPanel } from './features/model';
import { SettingsPanel } from './features/settings';
import { MissionPanel } from './features/mission';
import { DfuPanel, useDfuStore } from './features/dfu';
import { CalibrationPanel } from './features/calibration';
import './App.css';

type TabKey = 'settings' | 'calibration' | 'mission' | 'dfu';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'settings', label: 'Settings' },
  { key: 'calibration', label: 'PID' },
  { key: 'mission', label: 'Mission' },
  { key: 'dfu', label: 'USB to TTL' },
];

/**
 * App.tsx
 * Shell aplikasi: wordmark FAAS, status koneksi/armed persisten di header
 * (bukan tab — status ini dipakai lintas fitur, bukan destinasi konten
 * sendiri, sesuai connectionStore di Bagian 9), dan tab strip untuk 3 alur
 * v1 (Bagian 1: Settings/Mission/DFU). Tanpa router, sesuai Bagian 2.
 *
 * Layar PALING depan (sebelum ConnectionPanel maupun tab strip): pemilihan
 * jenis airframe (features/model/ModelSelectPanel, modelStore.ts). Selama
 * `selectedModel` belum diisi, tidak ada tab/koneksi apa pun yang ditampilkan
 * — device picker dan tuning (Settings/PID) baru relevan setelah jenis
 * airframe diketahui, karena itu menentukan skema mixer yang dipakai.
 *
 * Selagi belum ada device terhubung, tab strip diganti ConnectionPanel penuh
 * (device picker WebUSB/WebSerial wajib dipicu dari user gesture — tidak ada
 * gunanya menampilkan tab yang semuanya butuh koneksi lebih dulu).
 *
 * SATU pengecualian: alur DFU (features/dfu) SENGAJA memutus koneksi serial
 * di tengah jalan (CMD_REBOOT_DFU membuat device reboot ke bootloader lalu
 * re-enumerasi sebagai device WebUSB DFU — lihat dfuCommands.ts &
 * dfuStore.ts). Kalau `connectionState !== 'connected'` selalu diartikan
 * "tampilkan ConnectionPanel", progres flashing yang sedang berjalan lewat
 * WebUSB akan ter-unmount begitu saja. `useDfuStore().active` dipakai di
 * sini sebagai pengecualian eksplisit: selama alur DFU aktif, tampilkan
 * DfuPanel apa adanya (bukan tab strip penuh — tab lain tetap butuh koneksi
 * serial yang memang belum ada selama fase ini).
 */
function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('settings');
  const connectionState = useConnectionStore((s) => s.connectionState);
  const armed = useConnectionStore((s) => s.deviceStatus?.armed ?? false);
  const activeTransport = useConnectionStore((s) => s.activeTransport);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const dfuActive = useDfuStore((s) => s.active);
  const startStandaloneDfu = useDfuStore((s) => s.startStandalone);
  const selectedModel = useModelStore((s) => s.selectedModel);
  const resetModel = useModelStore((s) => s.resetModel);

  const isConnected = connectionState === 'connected';

  // "Ganti Model" memutus koneksi serial dulu (kalau ada) sebelum kembali ke
  // ModelSelectPanel — supaya tidak ada koneksi/tuning yang jalan diam-diam
  // untuk device sambil layar pemilihan airframe ditampilkan lagi.
  const handleChangeModel = () => {
    if (isConnected) void disconnect();
    resetModel();
  };

  // Alur DFU memutus koneksi serial dengan sengaja (CMD_REBOOT_DFU) lalu user
  // menyambung ulang lewat DfuPanel untuk lanjut ke verifikasi CMD_FLASH_HASH
  // (lihat dfuStore.ts). `activeTab` di sini murni state lokal, tidak ikut
  // berubah otomatis saat App.tsx keluar dari mode standalone DfuPanel
  // (!isConnected) kembali ke tab-strip biasa — kalau dibiarkan, user
  // mendarat di tab manapun yang aktif *sebelum* alur DFU dimulai, bukan di
  // tab DFU tempat tombol "Verifikasi" berada. `wasConnectedRef` dipakai
  // untuk mendeteksi transisi disconnected→connected secara presisi (bukan
  // sekadar "isConnected && dfuActive" yang juga bisa true di awal alur saat
  // koneksi belum sempat putus, mis. mock transport yang tidak benar-benar
  // reboot) — begitu tepi itu terdeteksi selagi alur DFU masih aktif, paksa
  // `activeTab` ke 'dfu'.
  const wasConnectedRef = useRef(isConnected);
  useEffect(() => {
    const justReconnected = !wasConnectedRef.current && isConnected;
    wasConnectedRef.current = isConnected;
    if (justReconnected && dfuActive) {
      setActiveTab('dfu');
    }
  }, [isConnected, dfuActive]);

  const showShell = isConnected || dfuActive;
  const statusState = armed ? 'armed' : connectionState;
  const statusLabel = armed
    ? 'ARMED'
    : connectionState === 'connected'
      ? 'Online'
      : connectionState === 'connecting'
        ? 'Menyambung…'
        : connectionState === 'error'
          ? 'Error'
          : dfuActive
            ? 'Mode DFU'
            : 'Offline';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">FAAS</span>
          <span className="brand-full-name">Flight Assistant Aurora System</span>
        </div>
        <div className="header-actions">
          {isConnected && activeTransport === 'mock' && <span className="demo-badge">Demo</span>}
          <div className="status-pill" data-state={statusState}>
            <span className="status-dot" aria-hidden="true" />
            <span>{statusLabel}</span>
          </div>
          {selectedModel && (
            <button type="button" className="disconnect-button" onClick={handleChangeModel}>
              Ganti Model
            </button>
          )}
          {isConnected && (
            <button type="button" className="disconnect-button" onClick={() => void disconnect()}>
              Putus
            </button>
          )}
        </div>
      </header>

      {!selectedModel ? (
        <main className="app-main">
          <ModelSelectPanel />
        </main>
      ) : !showShell ? (
        <main className="app-main">
          <ConnectionPanel onStartStandaloneDfu={startStandaloneDfu} />
        </main>
      ) : !isConnected ? (
        // dfuActive tapi belum/sudah tidak terhubung serial (mis. sesudah
        // CMD_REBOOT_DFU, sebelum device disambung lagi lewat WebUSB/serial)
        // — tanpa tab strip, tab lain semua butuh koneksi yang memang belum
        // ada. DfuPanel sendiri menawarkan tombol sambung-ulang serial.
        <main className="app-main">
          <DfuPanel />
        </main>
      ) : (
        <>
          <nav className="tab-strip" role="tablist" aria-label="Alur konfigurasi">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                className="tab-button"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <main className="app-main" role="tabpanel">
            {activeTab === 'settings' && <SettingsPanel />}
            {activeTab === 'calibration' && <CalibrationPanel />}
            {activeTab === 'mission' && <MissionPanel />}
            {activeTab === 'dfu' && <DfuPanel />}
          </main>
        </>
      )}
    </div>
  );
}

export default App;