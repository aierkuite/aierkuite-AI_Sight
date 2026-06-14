import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCamera } from "../useCamera";

/**
 * 作用：安装测试用 mediaDevices 对象
 * 参数：stream 模拟媒体流
 * 返回：模拟 getUserMedia 方法
 */
function installMediaDevices(stream: MediaStream): ReturnType<typeof vi.fn> {
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return getUserMedia;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCamera", () => {
  it("卸载时停止摄像头轨道", async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    const getUserMedia = installMediaDevices(stream);

    const { result, unmount } = renderHook(() => useCamera());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
      audio: false,
    });

    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
