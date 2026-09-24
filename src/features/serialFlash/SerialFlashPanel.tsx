import { isWebSerialSupported, SERIAL_BAUD_RATES } from '../../core/flash/webSerialByteStream';
import type { FlashPhase } from '../../core/flash/stm32Bootloader';
import { parseAddressText, useSerialFlashStore } from './serialFlashStore';
import './SerialFlashPanel.css';

const PHASE_LABEL: Record<FlashPhase, string> = {
  init: 'Menghubungi bootloader…',
  erase: 'Menghapus flash…',
  write: 'Menulis firmware…',
  verify: 'Memverifikasi…',
  go: 'Menjalankan aplikasi…',
};

const hex8 = (n: number) => '0x' + n.toString(16).toUpperCase().padStart(8, '0');

interface Props {
  /** Alasan tombol Mulai dinonaktifkan dari luar panel (mis. device FAAS yang terhubung sedang armed). */
  disabledReason?: string | null;
}

/**
 * features/serialFlash/SerialFlashPanel.tsx
 *
 * Flash firmware lewat WebSerial — alternatif untuk alur DFU WebUSB
 * (features/dfu). Protokol yang dipakai adalah ROM bootloader USART STM32
 * (AN3155), jadi syaratnya BERBEDA dari DFU USB:
 *  - device harus ada di ROM bootloader (BOOT0 high saat reset), BUKAN
 *    di firmware FAAS — tidak ada command FAAS yang bisa menyeberangkan ke
 *    sana lewat port USB native, dan ROM bootloader tidak bicara lewat USB CDC;
 *  - port yang dipilih adalah adapter USB-UART yang tersambung ke pin
 *    TX/RX USART bootloader di board.
 * Karena itu panel ini tidak bergantung pada connectionStore/DeviceClient
 * dan bisa dipakai juga saat belum ada koneksi FAAS (lihat App.tsx).
 */
function SerialFlashPanel({ disabledReason = null }: Props) {
  const {
    status,
    phase,
    progressPct,
    log,
    error,
    started,
    fileName,
    preview,
    fileError,
    startAddressText,
    baudRate,
    verify,
    runAfter,
    selectFile,
    setStartAddressText,
    setBaudRate,
    setVerify,
    setRunAfter,
    start,
    abort,
    reset,
  } = useSerialFlashStore();

  const supported = isWebSerialSupported();
  const running = status === 'running';
  const isBin = fileName?.toLowerCase().endsWith('.bin') ?? false;
  const addressInvalid = isBin && parseAddressText(startAddressText) === null;
  const canStart = supported && !running && !!preview && !fileError && !addressInvalid && !disabledReason;

  return (
    <div className="sflash-panel">
      <div className="sflash-intro">
        <h2>Flash Firmware via UART</h2>
        <p>
          Menulis firmware lewat bootloader UART bawaan STM32 memakai adapter USB-UART. Ini jalur terpisah dari DFU USB
          dan tidak memakai koneksi FAAS.
        </p>
      </div>

      {!supported && (
        <p className="sflash-hint sflash-hint-error">
          Browser ini tidak mendukung Web Serial. Gunakan Chrome atau Edge versi desktop.
        </p>
      )}

      <section className="sflash-card">
        <h3>Persiapan</h3>
        <ol className="sflash-steps">
          <li>Sambungkan TX/RX adapter USB-UART ke pin USART bootloader di board (TX ke RX, RX ke TX, GND bersama).</li>
          <li>Tahan BOOT0 ke high, lalu reset atau nyalakan board sehingga masuk ROM bootloader.</li>
          <li>Pilih file firmware di bawah, tekan Mulai, lalu pilih port adapter di dialog browser.</li>
        </ol>
        <p className="sflash-hint">
          Port USB native board (yang dipakai koneksi FAAS) tidak bisa dipakai di sini — ROM bootloader hanya bicara
          lewat UART.
        </p>
      </section>

      <section className="sflash-card">
        <h3>Firmware</h3>

        <div className="sflash-field-row">
          <label className="sflash-file-button">
            <input
              type="file"
              accept=".bin,.hex,.ihx"
              disabled={running}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void selectFile(file);
                e.target.value = ''; // izinkan memilih file yang sama lagi setelah diubah di disk
              }}
            />
            {fileName ? 'Ganti file' : 'Pilih file .bin / .hex'}
          </label>
          <span className="sflash-file-name">{fileName ?? 'Belum ada file dipilih'}</span>
        </div>

        {fileError && <p className="sflash-hint sflash-hint-error">{fileError}</p>}

        {preview && (
          <p className="sflash-summary">
            {preview.totalBytes.toLocaleString('id-ID')} byte dalam {preview.segments.length} segmen
            {preview.segments.length <= 3 && ` (${preview.segments.map((s) => hex8(s.address)).join(', ')})`}
          </p>
        )}

        <div className="sflash-options">
          {isBin && (
            <label className="sflash-option">
              <span>Alamat awal</span>
              <input
                type="text"
                className="sflash-input"
                value={startAddressText}
                spellCheck={false}
                disabled={running}
                aria-invalid={addressInvalid}
                onChange={(e) => setStartAddressText(e.target.value)}
              />
            </label>
          )}
          <label className="sflash-option">
            <span>Baud rate</span>
            <select
              className="sflash-input"
              value={baudRate}
              disabled={running}
              onChange={(e) => setBaudRate(Number(e.target.value))}
            >
              {SERIAL_BAUD_RATES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
        {addressInvalid && (
          <p className="sflash-hint sflash-hint-error">Alamat awal tidak valid — tulis heksadesimal, mis. 0x08000000.</p>
        )}

        <label className="sflash-check">
          <input type="checkbox" checked={verify} disabled={running} onChange={(e) => setVerify(e.target.checked)} />
          Verifikasi dengan baca-ulang setelah menulis
        </label>
        <label className="sflash-check">
          <input type="checkbox" checked={runAfter} disabled={running} onChange={(e) => setRunAfter(e.target.checked)} />
          Jalankan firmware setelah selesai
        </label>

        <p className="sflash-hint sflash-hint-warn">
          Seluruh flash dihapus sebelum menulis, termasuk data lain di luar firmware (mis. setting yang tersimpan di
          flash). Jangan cabut adapter atau batalkan di tengah proses — firmware jadi tidak lengkap sampai di-flash ulang.
        </p>
      </section>

      <section className="sflash-card">
        <div className="sflash-progress-head">
          <h3>Progres</h3>
          <span className="sflash-state-badge" data-state={status}>
            {status === 'idle' && 'Siap'}
            {status === 'running' && (phase ? PHASE_LABEL[phase] : 'Berjalan…')}
            {status === 'done' && 'Selesai'}
            {status === 'error' && 'Gagal'}
          </span>
        </div>

        <div
          className="sflash-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
        >
          <div className="sflash-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="sflash-progress-label">{status === 'idle' ? '\u00A0' : `${progressPct}%`}</div>

        {disabledReason && !running && <p className="sflash-hint sflash-hint-warn">{disabledReason}</p>}
        {error && <p className="sflash-hint sflash-hint-error">{error}</p>}
        {status === 'done' && started === true && (
          <p className="sflash-hint sflash-hint-ok">Firmware tertulis dan aplikasi dijalankan.</p>
        )}
        {status === 'done' && started !== true && (
          <p className="sflash-hint sflash-hint-ok">
            Firmware tertulis
            {started === false ? ', tetapi device menolak perintah jalankan (kemungkinan read-protection)' : ''}. Turunkan
            BOOT0 ke low lalu reset board untuk menjalankannya.
          </p>
        )}

        {status === 'done' && (
          <p className="sflash-hint">
            Langkah berikutnya: setelah device menyala dan tersambung ke FAAS, jalankan Kalibrasi awal di tab Kalibrasi.
          </p>
        )}

        {log.length > 0 && (
          <pre className="sflash-log" role="log">
            {log.join('\n')}
          </pre>
        )}

        <div className="sflash-actions">
          {running ? (
            <button type="button" className="sflash-button sflash-button-ghost" onClick={abort}>
              Batalkan
            </button>
          ) : (
            <>
              {(status === 'done' || status === 'error') && (
                <button type="button" className="sflash-button sflash-button-ghost" onClick={reset}>
                  Atur ulang
                </button>
              )}
              <button
                type="button"
                className="sflash-button sflash-button-primary"
                disabled={!canStart}
                onClick={() => void start()}
              >
                Mulai Flash
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default SerialFlashPanel;
