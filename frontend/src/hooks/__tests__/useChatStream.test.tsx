import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatStreamError } from "../../lib/chatStream";
import type { ChatRequest } from "../../types/chat";
import { useChatStream } from "../useChatStream";

const REQUEST: ChatRequest = {
  text: "看到了什么",
  image: "aGk=",
  history: [],
};

/**
 * 作用：创建包含 SSE 文本的 fetch Response
 * 参数：body SSE 响应文本
 * 返回：可被 hook 流式读取的 Response
 */
function streamResponse(body: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * 作用：断言测试中已捕获 AbortSignal
 * 参数：signal 可能为空的 AbortSignal
 * 返回：已确认非空的 AbortSignal
 */
function requireAbortSignal(signal: AbortSignal | null): AbortSignal {
  if (signal === null) {
    throw new Error("未捕获 AbortSignal");
  }
  return signal;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useChatStream", () => {
  it("累积 delta 并在 done 后结束", async () => {
    const fetchMock = vi.fn<Window["fetch"]>().mockResolvedValue(
      streamResponse('data: {"delta":"你"}\n\ndata: {"delta":"好"}\n\nevent: done\ndata: {}\n\n'),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChatStream());
    let finalAnswer = "";

    await act(async () => {
      finalAnswer = await result.current.send(REQUEST);
    });

    expect(finalAnswer).toBe("你好");
    expect(result.current.answer).toBe("你好");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(REQUEST),
      }),
    );
  });

  it("暴露 error 帧中的中文消息", async () => {
    const fetchMock = vi
      .fn<Window["fetch"]>()
      .mockResolvedValue(streamResponse('event: error\ndata: {"message":"认证失败"}\n\n'));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChatStream());
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.send(REQUEST);
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ChatStreamError);
    expect(result.current.error).toBe("认证失败");
    expect(result.current.isStreaming).toBe(false);
  });

  it("主动 abort 不展示错误", async () => {
    let abortSignal: AbortSignal | null = null;
    const fetchMock = vi.fn<Window["fetch"]>().mockImplementation((_input, init) => {
      abortSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        abortSignal?.addEventListener("abort", () => {
          reject(new DOMException("已取消", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChatStream());
    let pending: Promise<string>;

    act(() => {
      pending = result.current.send(REQUEST);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    act(() => {
      result.current.abort();
    });

    await expect(pending!).resolves.toBe("");
    expect(result.current.error).toBeNull();
    const signal = requireAbortSignal(abortSignal);
    expect(signal.aborted).toBe(true);
  });
});
