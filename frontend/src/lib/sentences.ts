export const SENTENCE_ENDINGS = new Set(["。", "！", "？", "!", "?", "\n"]);

interface SpeakableParts {
  ready: string[];
  rest: string;
}

/**
 * 作用：切出可以立即播报的完整句子
 * 参数：buffer 当前累计文本，flush 是否强制播报剩余文本
 * 返回：可播报句子列表和剩余缓冲文本
 */
export function takeSpeakableParts(buffer: string, flush: boolean): SpeakableParts {
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
