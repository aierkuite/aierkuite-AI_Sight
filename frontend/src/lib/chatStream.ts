import type { ChatEvent, ChatRequest } from "../types/chat";
import { CHAT_ENDPOINT } from "./constants";

interface StreamHandlers {
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export class ChatStreamError extends Error {
  /**
   * 作用：创建聊天流错误
   * 参数：message 可展示给用户的中文错误信息
   * 返回：ChatStreamError 实例
   */
  constructor(message: string) {
    super(message);
    this.name = "ChatStreamError";
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
 * 作用：安全解析 JSON 字符串
 * 参数：text SSE data 字段中的 JSON 文本
 * 返回：解析后的未知值，失败时返回 null
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 作用：把单个 SSE 帧解析为 ChatEvent
 * 参数：frame 不含空行分隔符的 SSE 帧文本
 * 返回：合法事件对象，无有效 data 时返回 null
 */
export function parseSseFrame(frame: string): ChatEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (eventName === "done") {
    return { type: "done" };
  }

  const data = dataLines.join("\n");
  if (!data) {
    return null;
  }

  const parsed = parseJson(data);
  if (!isRecord(parsed)) {
    return { type: "error", message: "AI 服务返回了无法识别的数据" };
  }

  if (eventName === "error") {
    const message = parsed.message;
    return {
      type: "error",
      message: typeof message === "string" ? message : "AI 服务返回了未知错误",
    };
  }

  const delta = parsed.delta;
  if (typeof delta === "string") {
    return { type: "delta", delta };
  }

  return { type: "error", message: "AI 服务返回了无法识别的数据" };
}

/**
 * 作用：处理解析后的聊天事件
 * 参数：event 聊天事件对象，handlers 调用方提供的事件回调
 * 返回：遇到 done 时返回 true，其余情况返回 false
 */
function dispatchEvent(event: ChatEvent, handlers: StreamHandlers): boolean {
  switch (event.type) {
    case "delta":
      handlers.onDelta(event.delta);
      return false;
    case "done":
      handlers.onDone();
      return true;
    case "error":
      handlers.onError(event.message);
      throw new ChatStreamError(event.message);
  }
}

/**
 * 作用：使用 fetch POST 请求并流式读取 /api/chat SSE
 * 参数：request 聊天请求体，handlers 流事件回调，signal AbortController 信号
 * 返回：流正常 done 后完成的 Promise
 */
export async function streamChatRequest(
  request: ChatRequest,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new ChatStreamError("请求失败，请检查输入后重试");
  }
  if (response.body === null) {
    throw new ChatStreamError("浏览器无法读取流式响应");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event !== null && dispatchEvent(event, handlers)) {
        return;
      }
    }
  }

  if (buffer.trim()) {
    const event = parseSseFrame(buffer);
    if (event !== null) {
      dispatchEvent(event, handlers);
    }
  }
}
