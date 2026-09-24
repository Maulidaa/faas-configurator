import { useRef } from 'react';
import { useConnectionStore } from '../../store/connectionStore';
import { DfuDevice } from '../../core/dfu';
import { useDfuStore, type DfuPhase } from './dfuStore';
import './DfuPanel.css';

const STEP_ORDER: { phase: DfuPhase[]; label: string }[] = [
  { phase: ['idle', 'rebooting'], label: 'Reboot ke DFU' },
  { phase: ['await-usb', 'usb-ready'], label: 'Sambungkan via WebUSB' },
  { phase: ['flashing'], label: 'Tulis Firmware' },
  { phase: ['awaiting-reconnect'], label: 'Sambung Ulang Serial' },
  { phase: ['verifying', 'verify-ok', 'verify-mismatch'], label: 'Verifikasi CMD_FLASH_HASH' },
];

function stepStatus(stepPhases: DfuPhase[], currentPhase: DfuPhase): 'done' | 'active' | 'pending' {
  const currentIndex = STEP_ORDER.findIndex((s) => s.phase.includes(currentPhase));
  const stepIndex = STEP_ORDER.findIndex((s) => s.phase === stepPhases);
  if (currentPhase === 'error') return 'pending';
  if (stepIndex < currentIndex) return 'done';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function hex32(n: number): string {
  return `0x${n.toString(16).padStart(8, '0')}`;
}

/**
 * features/dfu/DfuPanel.tsx
 * Alur: CMD_REBOOT_DFU (lewat DeviceClient/serial, dfuCommands.ts) → device
 * re-enumerasi sebagai bootloader ROM ST (VID:PID 0x0483:0xDF11) → flashing
 * DfuSe murni lewat WebUSB (core/dfu/, DI LUAR protokol frame custom —
 * protocol.md Bagian 11) → device reset balik ke app → sambung ulang serial
 * → CMD_FLASH_HASH untuk verifikasi (dibandingkan ke CRC32 file yang
 * dihitung sendiri, core/dfu/crc32.ts).
 *
 * Bisa dirender di dua tempat oleh App.tsx: full-screen selagi
 * `connectionState !== 'connected'` TAPI `dfuStore.active` (pertengahan
 * flashing, serial memang sengaja putus), atau sebagai isi tab 'DFU' biasa
 * selagi terhubung. Semua state alur hidup di dfuStore (zustand), bukan
 * useState lokal, supaya remount akibat transisi itu tidak membuang progres.
 */
function DfuPanel() {
  const client = useConnectionStore((s) => s.client);
  const armed = useConnectionStore((s) => s.deviceStatus?.armed ?? false);
  const connectionState = useConnectionStore((s) => s.connectionState);
  const connectSerial = useConnectionStore((s) => s.connectSerial);

  const {
    active,
    phase,
    error,
    rebootNote,
    firmware,
    startAddress,
    memoryLayoutSummary,
    progress,
    deviceCrc32,
    setFirmwareFile,
    setStartAddress,
    rebootToDfu,
    pickUsbDevice,
    startFlash,
    verifyFlash,
    reset,
  } = useDfuStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const webusbSupported = DfuDevice.isSupported();
  const isConnected = connectionState === 'connected';

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    setFirmwareFile(file.name, buf);
  };

  return (
    <div className="dfu-panel">
      <div className="dfu-intro">
        <h2>DFU Firmware Upload</h2>
        <p>
          Flash firmware baru ke device via WebUSB DFU (DfuSe standar, di luar protokol frame
          custom), lalu verifikasi hasil tulis dengan <code className="mono">CMD_FLASH_HASH</code>.
        </p>
      </div>

      {armed && phase === 'idle' && (
        <div className="dfu-armed-banner">
          Device sedang <strong>ARMED</strong>. <code className="mono">CMD_REBOOT_DFU</code> wajib
          ditolak firmware saat armed=true (protocol.md Bagian 11) — disarm device dulu.
        </div>
      )}

      {!webusbSupported && (
        <div className="dfu-armed-banner">
          Browser ini tidak mendukung WebUSB API. Buka halaman ini dari Chrome atau Edge versi
          desktop untuk melakukan flashing DFU.
        </div>
      )}

      <ol className="dfu-steps">
        {STEP_ORDER.map((step) => (
          <li key={step.label} className="dfu-step" data-status={active ? stepStatus(step.phase, phase) : 'pending'}>
            <span className="dfu-step-dot" aria-hidden="true" />
            {step.label}
          </li>
        ))}
      </ol>

      {error && (
        <div className="dfu-error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="dfu-section">
        <h3>1. Firmware</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".bin,.dfu"
          className="dfu-file-input"
          onChange={(e) => void handleFileChange(e)}
          disabled={phase === 'flashing' || phase === 'verifying'}
        />
        {firmware && (
          <div className="dfu-firmware-summary mono">
            <span>{firmware.name}</span>
            <span>{formatBytes(firmware.size)}</span>
            <span>CRC32 (asumsi): {hex32(firmware.crc32)}</span>
          </div>
        )}
        <label className="dfu-address-field">
          Alamat awal flash (u32)
          <input
            type="text"
            className="mono"
            value={`0x${startAddress.toString(16)}`}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 16);
              if (!Number.isNaN(parsed)) setStartAddress(parsed);
            }}
            disabled={phase === 'flashing' || phase === 'verifying'}
          />
        </label>
        <p className="dfu-hint">
          Default base flash STM32F411 (0x08000000) — file .bin mentah ditulis langsung dari sini
          tanpa offset bootloader custom (RDP level 0, bootloader ROM ST bawaan).
        </p>
      </div>

      <div className="dfu-workflow">
        <div className="dfu-section">
          <h3>2. Reboot ke Mode DFU</h3>
          <p className="dfu-hint">
            Payload kosong, armed-gated (protocol.md Bagian 11). Sesudah ini device diharapkan
            re-enumerasi sebagai device DFU — koneksi serial saat ini akan putus, itu normal.
          </p>
          <button
            type="button"
            className="dfu-button dfu-button-primary"
            onClick={() => void rebootToDfu(client)}
            disabled={armed || !isConnected || (active && phase !== 'idle') || phase === 'error'}
          >
            {phase === 'rebooting' ? 'Mengirim CMD_REBOOT_DFU…' : 'Reboot ke Mode DFU'}
          </button>
          {rebootNote && <p className="dfu-hint dfu-hint-ok">{rebootNote}</p>}
        </div>

        {active && (phase === 'await-usb' || phase === 'usb-ready') && (
          <div className="dfu-section">
            <h3>3. Sambungkan Device DFU (WebUSB)</h3>
            <p className="dfu-hint">
              Device picker WebUSB wajib dipicu dari klik langsung — pilih device dengan nama
              bootloader ST (VID:PID 0x0483:0xDF11), atau device manapun kalau filter tidak match.
            </p>
            <button
              type="button"
              className="dfu-button dfu-button-secondary"
              onClick={() => void pickUsbDevice()}
              disabled={!webusbSupported}
            >
              Pilih Device DFU (WebUSB)
            </button>
            {memoryLayoutSummary && <p className="dfu-hint dfu-hint-ok mono">{memoryLayoutSummary}</p>}
          </div>
        )}

        {active && phase === 'usb-ready' && (
          <div className="dfu-section">
            <h3>4. Tulis Firmware</h3>
            <button
              type="button"
              className="dfu-button dfu-button-primary"
              onClick={() => void startFlash()}
              disabled={!firmware}
            >
              Mulai Flash
            </button>
            {!firmware && <p className="dfu-hint">Pilih file firmware (.bin) dulu di langkah 1.</p>}
          </div>
        )}

        {phase === 'flashing' && (
          <div className="dfu-section">
            <h3>4. Menulis Firmware…</h3>
            {progress && (
              <>
                <div className="dfu-progress-bar">
                  <div
                    className="dfu-progress-fill"
                    style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }}
                  />
                </div>
                <p className="dfu-hint">
                  {progress.stage === 'erase' && `Menghapus sektor ${progress.current}/${progress.total}`}
                  {progress.stage === 'write' && `Menulis chunk ${progress.current}/${progress.total}`}
                  {progress.stage === 'manifest' && 'Memicu reset device (manifest)…'}
                </p>
              </>
            )}
          </div>
        )}

        {active && phase === 'awaiting-reconnect' && (
          <div className="dfu-section">
            <h3>5. Sambung Ulang via USB Serial</h3>
            <p className="dfu-hint">
              Flashing selesai — device sudah reset ke aplikasi normal. Sambungkan kembali via USB
              Serial (bukan WebUSB) untuk melanjutkan ke verifikasi.
            </p>
            <button
              type="button"
              className="dfu-button dfu-button-secondary"
              onClick={() => void connectSerial()}
              disabled={isConnected}
            >
              {isConnected ? 'Sudah Tersambung' : 'Hubungkan via USB Serial'}
            </button>
          </div>
        )}

        {active && isConnected && (phase === 'awaiting-reconnect' || phase === 'verify-mismatch') && (
          <div className="dfu-section">
            <h3>6. Verifikasi CMD_FLASH_HASH</h3>
            <button type="button" className="dfu-button dfu-button-primary" onClick={() => void verifyFlash(client)}>
              Verifikasi
            </button>
          </div>
        )}

        {phase === 'verifying' && <p className="dfu-hint">Menghitung CRC32 di device…</p>}

        {(phase === 'verify-ok' || phase === 'verify-mismatch') && firmware && deviceCrc32 !== null && (
          <div className={`dfu-verify-result ${phase === 'verify-ok' ? 'dfu-verify-ok' : 'dfu-verify-mismatch'}`}>
            <p>
              <strong>{phase === 'verify-ok' ? 'Cocok.' : 'Tidak cocok.'}</strong>
            </p>
            <p className="mono">Expected (file lokal): {hex32(firmware.crc32)}</p>
            <p className="mono">Device (CMD_FLASH_HASH): {hex32(deviceCrc32)}</p>
            {phase === 'verify-mismatch' && (
              <p className="dfu-hint">
                CRC32 device dihitung lewat peripheral hardware STM32 — layout register persisnya
                belum dikonfirmasi firmware (lihat komentar core/dfu/crc32.ts, "ASUMSI KERJA").
                Mismatch di sini bisa berarti flash benar-benar korup, ATAU cuma perbedaan asumsi
                konfigurasi CRC — jangan langsung divonis flashing gagal sebelum dicek manual.
              </p>
            )}
          </div>
        )}
      </div>

      {active && (
        <div className="dfu-footer">
          <button type="button" className="dfu-button dfu-button-ghost" onClick={reset}>
            {phase === 'verify-ok' ? 'Selesai' : 'Batalkan / Reset Alur'}
          </button>
        </div>
      )}
    </div>
  );
}

export default DfuPanel;
