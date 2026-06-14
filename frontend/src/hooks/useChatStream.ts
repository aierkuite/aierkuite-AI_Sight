import { useCallback, useEffect, useRef, useState } from "react";

import { ChatStreamError, streamChatRequest } from "../lib/chatStream";
import type { ChatRequest, SendOptions } from "../types/chat";

interface UseChatStreamResult {
  isStreaming: boolean;
  answer: string;
  error: string | null;
  send: (request: ChatRequest, options?: SendOptions) => Promise<string>;
  abort: () => void;
}

/**
 * 作用：判断异常是否来自主动取消
 * 参数：error 捕获到的未知异常
 * 返回：主动取消时返回 true
 */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

/**
 * 作用：把未知异常转成中文错误信息
 * 参数：error 捕获到的未知异常
 * 返回：可展示给用户的中文错误信息
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof ChatStreamError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "请求失败，请稍后再试";
}

/**
 * 作用：封装 /api/chat 的 fetch SSE 流式请求
 * 参数：无
 * 返回：请求状态、流式答案、错误信息、send 与 abort 方法
 */
export function useChatStream(): UseChatStreamResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (request: ChatRequest, options?: SendOptions): Promise<string> => {
      abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      let accumulated = "";

      setAnswer("");
      setError(null);
      setIsStreaming(true);

      try {
        await streamChatRequest(
          request,
          {
            onDelta: (delta) => {
              accumulated += delta;
              setAnswer(accumulated);
              options?.onDelta?.(delta);
            },
            onDone: () => {
              options?.onDone?.();
            },
            onError: (message) => {
              setError(message);
            },
          },
          controller.signal,
        );
        return accumulated;
      } catch (caughtError) {
        if (isAbortError(caughtError)) {
          return accumulated;
        }
        const message = toErrorMessage(caughtError);
        setError(message);
        throw new ChatStreamError(message);
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [abort],
  );

  useEffect(() => abort, [abort]);

  return { isStreaming, answer, error, send, abort };
}
