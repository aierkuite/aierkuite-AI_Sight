import { TTS_ENDPOINT } from "./constants";

const DEFAULT_TTS_ERROR = "语音播报失败，请稍后再试";

export class TtsError extends Error {
  /**
   * 作用：创建语音合成错误
   * 参数：message 可展示给用户的中文错误信息
   * 返回：TtsError 实例
   */
  constructor(message: string) {
    super(message);
    this.name = "TtsError";
  }
}

/**
 * 作用：判断未知值是否为普通对象
 * 参数：value 需要检查的未知值
 * 返回：是普通对象时返回 true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 作用：从失败响应中读取后端返回的安全中文错误
 * 参数：response 后端 /api/tts 的失败响应
 * 返回：可展示给用户的中文错误信息
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    return DEFAULT_TTS_ERROR;
  }
  return DEFAULT_TTS_ERROR;
}

/**
 * 作用：调用后端合成 wav 音频
 * 参数：text 待合成的文本，signal 用于取消在途请求
 * 返回：可交给 HTMLAudioElement 播放的音频 Blob
 */
export async function fetchSentenceAudio(text: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok) {
    throw new TtsError(await readErrorMessage(response));
  }

  return response.blob();
}
