import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechSynthesisResult {
  supported: boolean;
  speaking: boolean;
  speak: (chunk: string) => void;
  flush: () => void;
  cancel: () => void;
}

const SENTENCE_ENDINGS = new Set(["。", "！", "？", "!", "?", "\n"]);

/**
 * 作用：切出可以立即播报的完整句子
 * 参数：buffer 当前累计文本，flush 是否强制播报剩余文本
 * 返回：可播报句子列表和剩余缓冲文本
 */
function takeSpeakableParts(buffer: string, flush: boolean): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let start = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    if (SENTENCE_ENDINGS.has(buffer[index])) {
      const sentence = buffer.slice(start, index + 1).trim();
      if (sentence) {
        ready.push(sentence);
      }
      start = index + 1;
    }
  }

  const rest = buffer.slice(start);
  if (flush && rest.trim()) {
    return { ready: [...ready, rest.trim()], rest: "" };
  }
  return { ready, rest };
}

/**
 * 作用：封装浏览器语音合成和分句早播
 * 参数：无
 * 返回：支持状态、播报状态、增量播报、冲刷和取消方法
 */
export function useSpeechSynthesis(): UseSpeechSynthesisResult {
  const [speaking, setSpeaking] = useState(false);
  const bufferRef = useRef("");
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const enqueue = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) {
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.onstart = () => {
        setSpeaking(true);
      };
      utterance.onend = () => {
        setSpeaking(window.speechSynthesis.speaking);
      };
      utterance.onerror = () => {
        setSpeaking(window.speechSynthesis.speaking);
      };
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  const speak = useCallback(
    (chunk: string) => {
      if (!supported) {
        return;
      }
      bufferRef.current += chunk;
      const { ready, rest } = takeSpeakableParts(bufferRef.current, false);
      bufferRef.current = rest;
      ready.forEach(enqueue);
    },
    [enqueue, supported],
  );

  const flush = useCallback(() => {
    const { ready, rest } = takeSpeakableParts(bufferRef.current, true);
    bufferRef.current = rest;
    ready.forEach(enqueue);
  }, [enqueue]);

  const cancel = useCallback(() => {
    bufferRef.current = "";
    if (supported) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, [supported]);

  useEffect(() => cancel, [cancel]);

  return { supported, speaking, speak, flush, cancel };
}
