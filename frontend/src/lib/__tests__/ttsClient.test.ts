import { afterEach, describe, expect, it, vi } from "vitest";

import { TtsError, fetchSentenceAudio } from "../ttsClient";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchSentenceAudio", () => {
  it("成功时返回音频 Blob", async () => {
    const blob = new Blob(["wav"], { type: "audio/wav" });
    const fetchMock = vi.fn<Window["fetch"]>().mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(fetchSentenceAudio("你好。", signal)).resolves.toEqual(blob);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "你好。" }),
        signal,
      }),
    );
  });

  it("非 200 时读取后端中文 message 并抛出 TtsError", async () => {
    const fetchMock = vi.fn<Window["fetch"]>().mockResolvedValue(
      new Response(JSON.stringify({ message: "语音合成认证失败" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSentenceAudio("你好。", new AbortController().signal)).rejects.toThrow(
      new TtsError("语音合成认证失败"),
    );
  });
});
