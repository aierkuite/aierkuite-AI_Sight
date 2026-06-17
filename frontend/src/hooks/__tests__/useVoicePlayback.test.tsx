import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PREFETCH, useVoicePlayback } from "../useVoicePlayback";

type AudioListener = EventListenerOrEventListenerObject;

class MockAudio {
  static instances: MockAudio[] = [];

  src = "";
  pause = vi.fn();
  load = vi.fn();
  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  private listeners = new Map<string, Set<AudioListener>>();

  /**
   * 作用：记录创建出的 mock 音频实例
   * 参数：无
   * 返回：MockAudio 实例
   */
  constructor() {
    MockAudio.instances.push(this);
  }

  /**
   * 作用：注册音频事件监听器
   * 参数：type 事件名称，listener 事件监听器
   * 返回：无
   */
  addEventListener(type: string, listener: AudioListener): void {
    const listeners = this.listeners.get(type) ?? new Set<AudioListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  /**
   * 作用：移除音频事件监听器
   * 参数：type 事件名称，listener 事件监听器
   * 返回：无
   */
  removeEventListener(type: string, listener: AudioListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /**
   * 作用：模拟删除音频元素属性
   * 参数：name 属性名称
   * 返回：无
   */
  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
    }
  }

  /**
   * 作用：触发 mock 音频事件
   * 参数：type 事件名称
   * 返回：无
   */
  emit(type: string): void {
    const event = new Event(type);
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

/**
 * 作用：创建可控 Promise
 * 参数：无
 * 返回：Promise 及其 resolve/reject 控制函数
 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

/**
 * 作用：创建模拟 wav 响应
 * 参数：label 用于区分响应内容的文本
 * 返回：包含 audio/wav Blob 的 Response
 */
function audioResponse(label: string): Response {
  return new Response(new Blob([label], { type: "audio/wav" }), {
    status: 200,
    headers: { "Content-Type": "audio/wav" },
  });
}

/**
 * 作用：安装 Audio 与 object URL 的测试替身
 * 参数：无
 * 返回：无
 */
function installBrowserAudioMocks(): void {
  let urlIndex = 0;
  MockAudio.instances = [];
  Object.defineProperty(window, "Audio", {
    value: MockAudio,
    configurable: true,
  });
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => {
      urlIndex += 1;
      return `blob:mock-${urlIndex}`;
    }),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
}

/**
 * 作用：获取已创建的 mock 音频实例
 * 参数：无
 * 返回：第一个 MockAudio 实例
 */
function requireAudio(): MockAudio {
  const audio = MockAudio.instances[0];
  if (audio === undefined) {
    throw new Error("未创建 Audio 实例");
  }
  return audio;
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
  MockAudio.instances = [];
});

describe("useVoicePlayback", () => {
  it("两句文本触发两次 fetch 并按顺序播放", async () => {
    installBrowserAudioMocks();
    const fetchMock = vi
      .fn<Window["fetch"]>()
      .mockResolvedValueOnce(audioResponse("one"))
      .mockResolvedValueOnce(audioResponse("two"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVoicePlayback());

    act(() => {
      result.current.speak("第一句。第二句。");
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const audio = requireAudio();
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { text: "第一句。" },
      { text: "第二句。" },
    ]);

    act(() => {
      audio.emit("ended");
    });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));

    act(() => {
      audio.emit("ended");
    });
    await waitFor(() => expect(result.current.speaking).toBe(false));
  });

  it("播放当前句前会继续补齐后续句子的预取", async () => {
    installBrowserAudioMocks();
    const pendingSecond = deferred<Response>();
    const pendingThird = deferred<Response>();
    const fetchMock = vi
      .fn<Window["fetch"]>()
      .mockResolvedValueOnce(audioResponse("one"))
      .mockReturnValueOnce(pendingSecond.promise)
      .mockReturnValueOnce(pendingThird.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVoicePlayback());

    act(() => {
      result.current.speak("第一句。第二句。第三句。");
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const audio = requireAudio();
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { text: "第一句。" },
      { text: "第二句。" },
      { text: "第三句。" },
    ]);

    act(() => {
      result.current.cancel();
    });
  });

  it("speakAll 会等待整段音频生成后再触发显示回调并播放", async () => {
    installBrowserAudioMocks();
    const pendingAudio = deferred<Response>();
    const events: string[] = [];
    const fetchMock = vi.fn<Window["fetch"]>().mockReturnValue(pendingAudio.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVoicePlayback());
    let playback: Promise<void>;

    act(() => {
      playback = result.current.speakAll("第一句。第二句。", () => {
        events.push("ready");
      });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      text: "第一句。第二句。",
    });
    expect(events).toEqual([]);
    expect(result.current.speaking).toBe(true);

    await act(async () => {
      pendingAudio.resolve(audioResponse("all"));
      await Promise.resolve();
    });

    const audio = requireAudio();
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["ready"]);

    act(() => {
      audio.emit("ended");
    });
    await expect(playback!).resolves.toBeUndefined();
    await waitFor(() => expect(result.current.speaking).toBe(false));
  });

  it("cancel 会中止在途 fetch 并暂停当前音频", async () => {
    installBrowserAudioMocks();
    let secondSignal: AbortSignal | null = null;
    const pendingSecond = deferred<Response>();
    const fetchMock = vi.fn<Window["fetch"]>().mockImplementation((_input, init) => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve(audioResponse("one"));
      }
      secondSignal = init?.signal ?? null;
      return pendingSecond.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVoicePlayback());

    act(() => {
      result.current.speak("第一句。第二句。");
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const audio = requireAudio();
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.cancel();
    });

    expect(requireAbortSignal(secondSignal).aborted).toBe(true);
    expect(audio.pause).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("AbortError reject 时不设置错误", async () => {
    installBrowserAudioMocks();
    let signal: AbortSignal | null = null;
    const fetchMock = vi.fn<Window["fetch"]>().mockImplementation((_input, init) => {
      signal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("已取消", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVoicePlayback());

    act(() => {
      result.current.speak("第一句。");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.cancel();
    });

    await waitFor(() => expect(requireAbortSignal(signal).aborted).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("非 200 时设置中文错误且 cancel 后清空", async () => {
    installBrowserAudioMocks();
    const fetchMock = vi.fn<Window["fetch"]>().mockResolvedValue(
      new Response(JSON.stringify({ message: "语音合成认证失败" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVoicePlayback());

    act(() => {
      result.current.speak("第一句。");
    });

    await waitFor(() => expect(result.current.error).toBe("语音合成认证失败"));

    act(() => {
      result.current.cancel();
    });

    expect(result.current.error).toBeNull();
  });

  it("同一时刻在途 fetch 不超过 MAX_PREFETCH", async () => {
    installBrowserAudioMocks();
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn<Window["fetch"]>().mockImplementation(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVoicePlayback());

    act(() => {
      result.current.speak("一。二。三。四。五。");
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(MAX_PREFETCH));
    expect(maxActive).toBeLessThanOrEqual(MAX_PREFETCH);
    act(() => {
      result.current.cancel();
    });
  });
});
