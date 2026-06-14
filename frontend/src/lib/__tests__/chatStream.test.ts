import { describe, expect, it } from "vitest";

import { parseSseFrame } from "../chatStream";

describe("parseSseFrame", () => {
  it("解析默认 delta 帧", () => {
    expect(parseSseFrame('data: {"delta":"你好"}')).toEqual({
      type: "delta",
      delta: "你好",
    });
  });

  it("解析 done 帧", () => {
    expect(parseSseFrame("event: done\ndata: {}")).toEqual({ type: "done" });
  });

  it("把无法识别的数据转成错误事件", () => {
    expect(parseSseFrame("data: not-json")).toEqual({
      type: "error",
      message: "AI 服务返回了无法识别的数据",
    });
  });
});
