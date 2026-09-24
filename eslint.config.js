// eslint.config.js
// Menegakkan aturan modularitas web-configurator-architecture.md Bagian 3:
//   - features/* TIDAK BOLEH saling import langsung.
//   - features/* hanya boleh bergantung ke core/* dan shared/*.
// oxlint (bawaan scaffold Vite) menangani lint umum lainnya. File ini
// SENGAJA sempit, cuma untuk aturan boundary ini.
//
// CATATAN: awalnya dicoba pakai eslint-plugin-boundaries (disebut di
// architecture doc Bagian 2 tabel), tapi di versi yang ter-install di
// environment ini rule dependency-nya tidak pernah flag pelanggaran sama
// sekali (diverifikasi lewat reproduksi minimal — kemungkinan bug resolusi
// import relatif di versi tsb). Diganti dengan `no-restricted-imports`
// bawaan ESLint core yang perilakunya sudah diverifikasi manual.
import tsParser from '@typescript-eslint/parser';

const FEATURES = ['connection', 'dfu', 'settings', 'mission', 'calibration', 'serialFlash', 'model'];

const languageOptions = {
  parser: tsParser,
  parserOptions: { ecmaFeatures: { jsx: true } },
};

export default [
  // Base block: kasih parser TS ke semua file src/ supaya (a) eslint bisa
  // parse sintaks TS/TSX sama sekali, dan (b) `eslint src` tidak error
  // "all files ignored" selagi features/* masih kosong.
  { files: ['src/**/*.{ts,tsx}'], languageOptions, rules: {} },
  ...FEATURES.map((feature) => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    languageOptions,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: FEATURES.filter((other) => other !== feature).map((other) => ({
            // Hanya sibling features/<other> (../<other>/...) atau path lengkap features/<other>;
            // `**/dfu` polos salah-tangkap core/dfu yang memang boleh diimpor.
            group: [`../${other}`, `../${other}/**`, `**/features/${other}`, `**/features/${other}/**`],
            message: `features/${feature} tidak boleh import dari features/${other} — features/* hanya boleh bergantung ke core/* dan shared/* (web-configurator-architecture.md Bagian 3)`,
          })),
        },
      ],
    },
  })),
];
