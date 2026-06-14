# Hook Guidelines

> Custom hooks own every interaction with a browser device or API: camera,
> speech recognition, speech synthesis, and the streaming chat request. Each hook
> encapsulates setup, a typed return, **feature detection**, and **cleanup on
> unmount**. Components stay presentational.

---

## The Four Hooks

| Hook | Wraps | Returns (shape) |
|------|-------|-----------------|
| `useCamera` | `navigator.mediaDevices.getUserMedia` + a canvas | `{ videoRef, ready, error, captureFrame() }` |
| `useSpeechRecognition` | `SpeechRecognition` / `webkitSpeechRecognition` | `{ supported, listening, transcript, start(), stop(), error }` |
| `useSpeechSynthesis` | `window.speechSynthesis` | `{ supported, speaking, speak(text), cancel() }` |
| `useChatStream` | `fetch` POST + SSE stream reader | `{ isStreaming, answer, error, send(req), abort() }` |

---

## Universal Rules

1. **Naming**: `useX`, one concern per hook, file `hooks/useX.ts`.
2. **Typed return**: return a typed object (not a positional tuple) so call sites
   read clearly.
3. **Feature-detect first**: expose `supported` and let the UI show a zh-CN
   fallback. Detect at module/effect time:
   `const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;`
4. **Cleanup on unmount** (non-negotiable): stop media tracks, abort recognition,
   cancel speech, abort the fetch — in the effect's cleanup function. Leaking a
   live camera/mic or a dangling stream is the most common bug class here.
5. **Errors as state, not throws**: surface `error` from the hook; components
   render it. Don't let an async browser callback throw into the void.

---

## `useCamera`

- Request the stream once; bind it to a `videoRef` for `CameraPreview`.
- `captureFrame()` draws the **current** video frame to an offscreen `<canvas>`
  and returns a **compressed base64 JPEG** (e.g. `canvas.toDataURL("image/jpeg", 0.7)`),
  stripped to raw base64 for the request body. This is the "screenshot on submit"
  behavior — capture at send time, not continuously.
- Cleanup: `stream.getTracks().forEach(t => t.stop())` on unmount.

## `useSpeechRecognition`

- `lang = "zh-CN"`; `interimResults` on so the transcript updates live.
- `start()`/`stop()` map to push-to-talk; expose `listening`.
- Cleanup: call `recognition.abort()` on unmount; guard the unsupported case.

## `useSpeechSynthesis`

- `speak(text)` enqueues an utterance; support **early/incremental playback** —
  speak buffered sentence chunks as deltas arrive rather than waiting for the full
  answer, to cut perceived latency.
- `cancel()` clears the queue on a new question and on unmount.

## `useChatStream`

The SSE consumer. **Uses `fetch`, not `EventSource`** (the request must POST text
+ image + history; `EventSource` is GET-only).

```ts
async function send(req: ChatRequest) {
  const controller = new AbortController();         // store for abort()/unmount
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  // decode, split on \n\n, parse `event:`/`data:` lines into ChatEvent,
  // append delta → answer, stop on `done`, surface `error.message`.
}
```

- Parse frames into the `ChatEvent` discriminated union from
  [type-safety.md](./type-safety.md); branch on `delta` / `done` / `error`.
- `abort()` cancels the in-flight stream; also abort in the unmount cleanup.
- Feed deltas to both `AnswerView` and `useSpeechSynthesis.speak`.

---

## Common Mistakes

- Forgetting cleanup → camera light stays on, mic keeps listening, or a stream
  keeps the connection open after the component unmounts.
- Using `EventSource` for `/api/chat` → can't send the image/history body.
- Calling `captureFrame()` continuously instead of once at send time → wasted
  work and against the "screenshot on submit" cost design.
- Returning the raw `SpeechRecognitionEvent` to components → leaks `any`-typed
  browser objects; map to a clean `transcript` string inside the hook.
- Swallowing the abort: treat `AbortError` as a normal cancel, not an error to show.
