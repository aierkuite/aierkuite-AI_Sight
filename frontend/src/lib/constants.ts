import type { HistoryTurn } from "../types/chat";

export const MAX_HISTORY_ROUNDS = 6;
export const CHAT_ENDPOINT = "/api/chat";

/**
 * 作用：裁剪历史消息到最近 6 轮纯文本
 * 参数：history 当前内存中的历史消息
 * 返回：最多 12 条 user/assistant 历史消息
 */
export function trimHistory(history: HistoryTurn[]): HistoryTurn[] {
  return history.slice(-MAX_HISTORY_ROUNDS * 2);
}

/**
 * 作用：追加一轮用户与助手对话并裁剪历史
 * 参数：history 当前历史消息，userText 用户问题，answer 助手回答
 * 返回：追加并裁剪后的历史消息
 */
export function appendRound(
  history: HistoryTurn[],
  userText: string,
  answer: string,
): HistoryTurn[] {
  return trimHistory([
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: answer },
  ]);
}
