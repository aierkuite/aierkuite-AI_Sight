# Component Guidelines

> How React components are built in this app. Components are **presentational**:
> they render state and emit callbacks. Browser-device work (camera, speech, SSE)
> lives in hooks, not in components.

---

## Component Structure

- **Function components only**, typed with an explicit props interface.
- One component per folder: `Name/Name.tsx` + `Name/Name.module.css`.
- Data in via props, intent out via callbacks. A component does **not** call
  `getUserMedia`, `fetch`, or `speechSynthesis` directly — those come from hooks
  owned higher up (see [hook-guidelines.md](./hook-guidelines.md)).

```tsx
import styles from "./TalkButton.module.css";

interface TalkButtonProps {
  listening: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function TalkButton({ listening, disabled, onStart, onStop }: TalkButtonProps) {
  return (
    <button
      className={styles.talk}
      aria-pressed={listening}
      aria-label={listening ? "停止说话" : "开始说话"}
      disabled={disabled}
      onPointerDown={onStart}
      onPointerUp={onStop}
    >
      {listening ? "松开结束" : "按住说话"}
    </button>
  );
}
```

---

## Props Conventions

- Name the interface `NameProps`; define it in the component file.
- Prefer explicit primitive/object props over passing whole hook objects.
- Callbacks are `onSomething`; booleans read as states (`listening`, `streaming`).
- No `any` in props. Optional props use `?`, not `| undefined` unions by hand.

---

## Styling: CSS Modules + Design Tokens

Styling is **CSS Modules** (`Name.module.css`) plus **CSS custom properties**
defined once in `styles/tokens.css`:

- Component-scoped rules live in the module file; import as `styles` and use
  `className={styles.x}`. This scopes names and avoids collisions as the UI grows.
- Shared colors, spacing, radii, and typography are CSS variables
  (`var(--color-accent)`, `var(--space-2)`) — restyle/theme by editing tokens, not
  every component.
- Decorative dynamic visuals (particles, animated backgrounds) are **not** done
  ad hoc here — they belong in the isolated `effects/` layer
  (see [directory-structure.md](./directory-structure.md)).

---

## Accessibility (required for this app)

The UX is voice + streaming text, so live regions and labels matter:

- **Streaming text** (`AnswerView`, `TranscriptView`) renders inside an
  `aria-live="polite"` region so updates are announced without stealing focus.
- **`TalkButton`** has an `aria-label` and `aria-pressed` reflecting listening state.
- **`ErrorBanner`** uses `role="alert"` so permission/unsupported errors are announced.
- Camera/mic permission prompts and denials produce visible, readable zh-CN copy
  (not just a console error).

---

## Common Mistakes

- Calling `navigator.mediaDevices.getUserMedia` or `fetch` inside a component
  instead of a hook → no cleanup, untestable, duplicated logic.
- Hard-coding colors/spacing in module files instead of using `tokens.css`
  variables → drift and painful theming.
- Updating the streamed answer in a non-`aria-live` element → screen readers miss it.
- Mixing decorative effect code into functional components → couples "make it
  prettier" to the chat flow.
- Using `any` for an event or props to dodge a type error — narrow it instead
  (see [type-safety.md](./type-safety.md)).
