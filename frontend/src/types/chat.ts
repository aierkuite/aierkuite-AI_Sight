export type HistoryRole = "user" | "assistant";

export interface HistoryTurn {
  role: HistoryRole;
  content: string;
}

export interface ChatRequest {
  text: string;
  image: string | null;
  history: HistoryTurn[];
}

export type ChatEvent =
  | { type: "delta"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface SendOptions {
  onDelta?: (delta: string) => void;
  onDone?: () => void;
}
