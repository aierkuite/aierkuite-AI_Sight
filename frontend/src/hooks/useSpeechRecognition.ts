import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechRecognitionResult {
  supported: boolean;
  listening: boolean;
  transcript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

/**
 * 作用：读取浏览器语音识别构造器
 * 参数：无
 * 返回：可用的 SpeechRecognition 构造器或 undefined
 */
function getRecognitionConstructor(): typeof SpeechRecognition | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/**
 * 作用：把识别错误码映射成中文提示
 * 参数：error 浏览器返回的错误码
 * 返回：可展示给用户的中文错误信息
 */
function mapSpeechError(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "麦克风权限被拒绝，请检查浏览器权限";
  }
  if (error === "no-speech") {
    return "没有识别到语音，请重新按住说话";
  }
  return "语音识别暂时不可用，请稍后重试";
}

/**
 * 作用：从识别事件中提取完整转写文本
 * 参数：event 浏览器语音识别结果事件
 * 返回：拼接后的转写文本
 */
function readTranscript(event: SpeechRecognitionEvent): string {
  const chunks: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const alternative = result[0];
    if (alternative !== undefined) {
      chunks.push(alternative.transcript);
    }
  }
  return chunks.join("").trim();
}

/**
 * 作用：封装中文语音识别和 push-to-talk 生命周期
 * 参数：无
 * 返回：识别状态、转写文本、错误信息和控制方法
 */
export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const supported = getRecognitionConstructor() !== undefined;

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (Recognition === undefined) {
      setError("当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge");
      return;
    }

    recognitionRef.current?.abort();
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      setTranscript(readTranscript(event));
    };
    recognition.onerror = (event) => {
      setError(mapSpeechError(event.error));
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    setTranscript("");
    setError(null);

    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("语音识别启动失败，请重新按住说话");
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition === null) {
      setListening(false);
      return;
    }

    try {
      recognition.stop();
    } catch {
      recognition.abort();
    }
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, transcript, error, start, stop, reset };
}
