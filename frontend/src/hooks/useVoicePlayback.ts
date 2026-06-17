import { useCallback, useEffect, useRef, useState } from "react";

import { takeSpeakableParts } from "../lib/sentences";
import { fetchSentenceAudio, TtsError } from "../lib/ttsClient";

interface UseVoicePlaybackResult {
  supported: boolean;
  speaking: boolean;
  error: string | null;
  speak: (chunk: string) => void;
  flush: () => void;
  speakAll: (text: string, onAudioReady?: () => void) => Promise<void>;
  cancel: () => void;
}

interface TtsJob {
  controller: AbortController;
  result: Promise<TtsFetchResult>;
}

type TtsFetchResult =
  | { ok: true; blob: Blob }
  | { ok: false; error: unknown };

export const MAX_PREFETCH = 2;

const GENERIC_TTS_ERROR = "语音播报失败，请稍后再试";
const AUDIO_PLAYBACK_ERROR = "语音音频播放失败，请稍后再试";

/**
 * 作用：判断异常是否来自主动取消
 * 参数：error 捕获到的未知异常
 * 返回：主动取消时返回 true
 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * 作用：把语音播报异常转成中文错误信息
 * 参数：error 捕获到的未知异常
 * 返回：可展示给用户的中文错误信息
 */
function toPlaybackErrorMessage(error: unknown): string {
  if (error instanceof TtsError) {
    return error.message;
  }
  if (error instanceof Error && error.message === AUDIO_PLAYBACK_ERROR) {
    return error.message;
  }
  return GENERIC_TTS_ERROR;
}

/**
 * 作用：封装后端 TTS 逐句或整段合成和播放
 * 参数：无
 * 返回：支持状态、播报状态、错误信息、增量播报、整段播报、冲刷和取消方法
 */
export function useVoicePlayback(): UseVoicePlaybackResult {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bufferRef = useRef("");
  const pendingRef = useRef<string[]>([]);
  const inFlightRef = useRef<TtsJob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  const failedRef = useRef(false);
  const objectUrlRef = useRef<string | null>(null);
  const currentPlaybackStopRef = useRef<(() => void) | null>(null);
  const fullTextControllerRef = useRef<AbortController | null>(null);
  const supported = typeof window !== "undefined" && typeof window.Audio !== "undefined";

  const revokeCurrentUrl = useCallback(() => {
    if (objectUrlRef.current !== null) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const ensureAudio = useCallback((): HTMLAudioElement | null => {
    if (!supported) {
      return null;
    }
    if (audioRef.current === null) {
      audioRef.current = new window.Audio();
    }
    return audioRef.current;
  }, [supported]);

  const playBlob = useCallback(
    async (blob: Blob): Promise<void> => {
      const audio = ensureAudio();
      if (audio === null) {
        throw new Error(AUDIO_PLAYBACK_ERROR);
      }

      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      audio.src = url;

      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          audio.removeEventListener("ended", finish);
          audio.removeEventListener("error", fail);
          if (currentPlaybackStopRef.current === finish) {
            currentPlaybackStopRef.current = null;
          }
          if (objectUrlRef.current === url) {
            revokeCurrentUrl();
          }
        };

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve();
        };

        const fail = (caughtError?: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          if (caughtError instanceof Error) {
            reject(caughtError);
            return;
          }
          reject(new Error(AUDIO_PLAYBACK_ERROR));
        };

        currentPlaybackStopRef.current = finish;
        audio.addEventListener("ended", finish, { once: true });
        audio.addEventListener("error", fail, { once: true });
        void audio.play().catch(fail);
      });
    },
    [ensureAudio, revokeCurrentUrl],
  );

  const stopPlayback = useCallback(() => {
    pendingRef.current = [];
    for (const job of inFlightRef.current) {
      job.controller.abort();
    }
    inFlightRef.current = [];
    fullTextControllerRef.current?.abort();
    fullTextControllerRef.current = null;
    bufferRef.current = "";
    currentPlaybackStopRef.current?.();
    const audio = audioRef.current;
    if (audio !== null) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    revokeCurrentUrl();
    playingRef.current = false;
    setSpeaking(false);
  }, [revokeCurrentUrl]);

  const handleFailure = useCallback(
    (caughtError: unknown) => {
      failedRef.current = true;
      stopPlayback();
      setError(toPlaybackErrorMessage(caughtError));
    },
    [stopPlayback],
  );

  const pump = useCallback(() => {
    if (!supported || failedRef.current) {
      return;
    }

    while (inFlightRef.current.length < MAX_PREFETCH && pendingRef.current.length > 0) {
      const text = pendingRef.current.shift();
      if (text === undefined) {
        break;
      }
      const controller = new AbortController();
      const result: Promise<TtsFetchResult> = fetchSentenceAudio(text, controller.signal).then(
        (blob): TtsFetchResult => ({ ok: true, blob }),
        (caughtError): TtsFetchResult => ({ ok: false, error: caughtError }),
      );
      inFlightRef.current.push({ controller, result });
    }
  }, [supported]);

  const startPlaybackLoop = useCallback(() => {
    if (!supported || playingRef.current || failedRef.current) {
      return;
    }

    playingRef.current = true;
    setSpeaking(true);

    void (async () => {
      try {
        while (!failedRef.current) {
          pump();
          const job = inFlightRef.current[0];
          if (job === undefined) {
            break;
          }

          const result = await job.result;
          if (inFlightRef.current[0] === job) {
            inFlightRef.current.shift();
          } else {
            inFlightRef.current = inFlightRef.current.filter((item) => item !== job);
          }

          if (!result.ok) {
            if (isAbortError(result.error)) {
              return;
            }
            handleFailure(result.error);
            return;
          }

          pump();

          try {
            await playBlob(result.blob);
          } catch (caughtError) {
            if (isAbortError(caughtError)) {
              return;
            }
            handleFailure(caughtError);
            return;
          }
        }
      } finally {
        playingRef.current = false;
        if (pendingRef.current.length === 0 && inFlightRef.current.length === 0) {
          setSpeaking(false);
        }
      }
    })();
  }, [handleFailure, playBlob, pump, supported]);

  const speak = useCallback(
    (chunk: string) => {
      if (!supported || failedRef.current) {
        return;
      }
      bufferRef.current += chunk;
      const { ready, rest } = takeSpeakableParts(bufferRef.current, false);
      bufferRef.current = rest;
      pendingRef.current.push(...ready);
      if (ready.length > 0) {
        pump();
        startPlaybackLoop();
      }
    },
    [pump, startPlaybackLoop, supported],
  );

  const flush = useCallback(() => {
    if (!supported || failedRef.current) {
      return;
    }
    const { ready, rest } = takeSpeakableParts(bufferRef.current, true);
    bufferRef.current = rest;
    pendingRef.current.push(...ready);
    if (ready.length > 0) {
      pump();
      startPlaybackLoop();
    }
  }, [pump, startPlaybackLoop, supported]);

  /**
   * 作用：整段文本合成为单个音频后再播放
   * 参数：text 待合成的完整文本，onAudioReady 音频生成完成后的回调
   * 返回：播放流程完成后的 Promise
   */
  const speakAll = useCallback(
    async (text: string, onAudioReady?: () => void): Promise<void> => {
      if (!supported) {
        return;
      }

      stopPlayback();
      failedRef.current = false;
      setError(null);

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const controller = new AbortController();
      fullTextControllerRef.current = controller;
      setSpeaking(true);

      try {
        const blob = await fetchSentenceAudio(trimmed, controller.signal);
        if (fullTextControllerRef.current !== controller || controller.signal.aborted) {
          return;
        }
        onAudioReady?.();
        await playBlob(blob);
      } catch (caughtError) {
        if (isAbortError(caughtError)) {
          return;
        }
        handleFailure(caughtError);
        throw new Error(toPlaybackErrorMessage(caughtError));
      } finally {
        if (fullTextControllerRef.current === controller) {
          fullTextControllerRef.current = null;
        }
        if (pendingRef.current.length === 0 && inFlightRef.current.length === 0) {
          setSpeaking(false);
        }
      }
    },
    [handleFailure, playBlob, stopPlayback, supported],
  );

  const cancel = useCallback(() => {
    stopPlayback();
    failedRef.current = false;
    setError(null);
  }, [stopPlayback]);

  useEffect(() => cancel, [cancel]);

  return { supported, speaking, error, speak, flush, speakAll, cancel };
}
