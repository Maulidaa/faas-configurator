import { useCallback, useState } from 'react';
import { sendChunkedMission, type DeviceClient } from '../../core/device';
import { homeSetCommand, rthTriggerCommand } from '../../core/commands/registry';
import type { HomePosition, NavMode, Waypoint } from '../../shared/types';

export type UploadPhase = 'idle' | 'uploading' | 'done' | 'error';

export interface UseMissionUploadResult {
  phase: UploadPhase;
  progress: { sent: number; total: number } | null;
  error: string | null;
  upload: (waypoints: Waypoint[]) => void;
}

/**
 * features/mission/useMissionUpload.ts
 * Tipis di atas sendChunkedMission (core/device) — fitur tidak pernah
 * memanggil missionUploadChunkCommand langsung (komentar di
 * core/commands/missionCommands.ts), cukup lewat helper ini.
 */
export function useMissionUpload(client: DeviceClient): UseMissionUploadResult {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    (waypoints: Waypoint[]) => {
      setPhase('uploading');
      setError(null);
      setProgress(null);

      sendChunkedMission(client, waypoints, {
        onProgress: (sent, total) => setProgress({ sent, total }),
      })
        .then(() => setPhase('done'))
        .catch((err: unknown) => {
          setPhase('error');
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [client],
  );

  return { phase, progress, error, upload };
}

export type HomeSendPhase = 'idle' | 'sending' | 'done' | 'error';

export interface UseHomeSendResult {
  phase: HomeSendPhase;
  error: string | null;
  send: (home: HomePosition) => void;
}

export function useHomeSend(client: DeviceClient): UseHomeSendResult {
  const [phase, setPhase] = useState<HomeSendPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    (home: HomePosition) => {
      setPhase('sending');
      setError(null);
      client
        .sendCommand(homeSetCommand, home)
        .then(() => setPhase('done'))
        .catch((err: unknown) => {
          setPhase('error');
          setError(err instanceof Error ? err.message : String(err));
        });
    },
    [client],
  );

  return { phase, error, send };
}

export type RthTriggerPhase = 'idle' | 'sending' | 'done' | 'error';

export interface UseRthTriggerResult {
  phase: RthTriggerPhase;
  navMode: NavMode | null;
  error: string | null;
  trigger: () => void;
}

/**
 * features/mission/useMissionUpload.ts — useRthTrigger
 * CMD_RTH_TRIGGER (protocol.md Bagian 5 & 10, BARU dari audit kode firmware).
 * Sengaja tidak dicek `armed` di sini — command ini memang dirancang tetap
 * bisa dikirim kapan pun, termasuk saat armed (lihat komentar di
 * missionCommands.ts / handle_rth_trigger firmware). Konfirmasi user (native
 * confirm) sengaja diletakkan di komponen pemanggil (MissionPanel.tsx), bukan
 * di sini, supaya hook ini tetap murni "kirim command" dan gampang ditest.
 */
export function useRthTrigger(client: DeviceClient): UseRthTriggerResult {
  const [phase, setPhase] = useState<RthTriggerPhase>('idle');
  const [navMode, setNavMode] = useState<NavMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trigger = useCallback(() => {
    setPhase('sending');
    setError(null);
    client
      .sendCommand(rthTriggerCommand, undefined)
      .then((result) => {
        setNavMode(result.navMode);
        setPhase(result.ok ? 'done' : 'error');
        if (!result.ok) setError('Device menolak trigger RTH.');
      })
      .catch((err: unknown) => {
        setPhase('error');
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [client]);

  return { phase, navMode, error, trigger };
}
