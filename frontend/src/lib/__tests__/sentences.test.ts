import { describe, expect, it } from "vitest";

import { takeSpeakableParts } from "../sentences";

describe("takeSpeakableParts", () => {
  it("按中英文句末标点切出多句", () => {
    expect(takeSpeakableParts("第一句。第二句!第三句还没完", false)).toEqual({
      ready: ["第一句。", "第二句!"],
      rest: "第三句还没完",
    });
  });

  it("未成句时保留全部缓冲", () => {
    expect(takeSpeakableParts("还没有结束", false)).toEqual({
      ready: [],
      rest: "还没有结束",
    });
  });

  it("flush 时播报剩余尾巴", () => {
    expect(takeSpeakableParts("尾巴文本", true)).toEqual({
      ready: ["尾巴文本"],
      rest: "",
    });
  });

  it("把换行作为可播报边界", () => {
    expect(takeSpeakableParts("第一行\n第二行？", false)).toEqual({
      ready: ["第一行", "第二行？"],
      rest: "",
    });
  });
});
