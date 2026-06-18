import { useEffect, useRef } from "react";

import { useCinematicStore } from "../store/cinematic";

/** 末页掭起预览的露出比例（工作台从屏幕底部升起的占比；0.2≈露出 20%）；App 据此把 shell translateY/opacity 抬到此处 */
export const PEEK_STOP = 0.2;

/** 5 页对应的 scrollProgress 锚点（0=Hero,1=看得见,2=听得懂,3=边想边答,4=CTA；已对照 CSS 区间核验） */
const ANCHORS = [0, 0.32, 0.52, 0.7, 1.0];

/** 各段补间时长（ms） */
const DUR_PAGE = 800; // 翻页滑动
const DUR_PEEK = 500; // 末页下滑① 掭起预览
const DUR_COMMIT = 650; // 末页下滑② 掭到离场→提交
const DUR_RETRACT = 450; // 预览态上滑退回

/** 动画结束后「再武装」所需的滚轮静默空档（ms）——连续滚轮流不断重启它，故一次连续滚动只翻一页 */
const REARM_MS = 120;
/** 触发一次翻页的累计 |deltaY|（像素，已按 deltaMode 归一） */
const WHEEL_THRESHOLD = 20;
/** 触发翻页的最小触摸滑动距离（像素） */
const TOUCH_THRESHOLD = 40;

/** easeInOutCubic 缓动：前后平滑、中段快，整屏翻页的标准手感 */
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * 作用：把开场改成离散整屏翻页——滚轮/键盘/触摸一次手势一页，用 JS rAF 在 5 个锚点间补间
 *   scrollProgress（绕开全局 reduced-motion 把 CSS 过渡压成 0.001ms 的规则，故减动态下也照常滑动）；
 *   末页两段式「掭起」：下滑① 预览露出工作台顶部、下滑② 掭到离场并提交进工作台（写 store.peek）。
 *   「一次连续滚动 = 一页」由动画锁 + 静默再武装的状态机保证（见内部 phase / armTimer）。
 * 参数：onEnter 提交进入工作台回调（末页下滑② 触发）
 * 返回：无
 */
export function usePagedScroll(onEnter: () => void): void {
  // Latest Ref Pattern：用 ref 锁定最新 onEnter，使主 effect 依赖恒为 []，
  //   保证 wheel/keydown/touch 监听只在 CinematicLanding 挂载时绑定一次，
  //   绝不因 App（持有 chat/语音/流式等高频 state）重渲染传入新 onEnter 而反复重挂、漏掉滚轮事件。
  const onEnterRef = useRef(onEnter);
  useEffect(() => {
    onEnterRef.current = onEnter;
  }, [onEnter]);

  useEffect(() => {
    const setP = useCinematicStore.getState().setScrollProgress;
    const setPeek = useCinematicStore.getState().setPeek;

    // —— 翻页状态机 ——
    //   phase: idle 可接受手势 / animating 补间中（忽略全部输入）/ cooldown 动画已结束但等再武装
    //   armTimer: tween 结束时启动；每个 wheel 事件都重启它；仅在「REARM_MS 内无 wheel 且动画已结束」时
    //             把 cooldown→idle。连续滚轮流不断重启它 → phase 卡在 cooldown 直到停手 120ms。
    let phase: "idle" | "animating" | "cooldown" = "idle";
    let pageIndex = 0;
    let peek = 0;
    let wheelAccum = 0;
    let rafId = 0;
    let armTimer = 0;

    // 每次进入开场都从首页/无掭起开始
    setP(0);
    setPeek(0);
    window.scrollTo(0, 0);

    const cancelRaf = (): void => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = 0;
    };

    const restartArmTimer = (): void => {
      if (armTimer) {
        window.clearTimeout(armTimer);
      }
      armTimer = window.setTimeout(() => {
        if (phase === "cooldown") {
          phase = "idle";
          wheelAccum = 0;
        }
      }, REARM_MS);
    };

    // 通用 rAF 补间：写 setter，结束置 cooldown 并启动 armTimer，再执行 onDone。同一时刻只跑一个补间。
    const tween = (
      from: number,
      to: number,
      dur: number,
      set: (value: number) => void,
      onDone?: () => void,
    ): void => {
      cancelRaf();
      phase = "animating";
      let t0 = 0;
      const step = (ts: number): void => {
        if (!t0) {
          t0 = ts;
        }
        const k = Math.min((ts - t0) / dur, 1);
        set(from + (to - from) * easeInOutCubic(k));
        if (k < 1) {
          rafId = window.requestAnimationFrame(step);
        } else {
          rafId = 0;
          phase = "cooldown";
          restartArmTimer();
          onDone?.();
        }
      };
      rafId = window.requestAnimationFrame(step);
    };

    const gotoPage = (target: number): void => {
      tween(ANCHORS[pageIndex], ANCHORS[target], DUR_PAGE, setP, () => {
        pageIndex = target;
      });
    };

    const setPeekTo = (to: number, dur: number, onDone?: () => void): void => {
      tween(
        peek,
        to,
        dur,
        (value) => {
          peek = value;
          setPeek(value);
        },
        () => {
          peek = to;
          onDone?.();
        },
      );
    };

    // 一次「已判定方向」的手势：dir>0 下/进，dir<0 上/退
    const dispatch = (dir: number): void => {
      if (phase !== "idle") {
        return;
      }
      if (dir > 0) {
        if (pageIndex < 4) {
          gotoPage(pageIndex + 1);
        } else if (peek === 0) {
          setPeekTo(PEEK_STOP, DUR_PEEK); // 末页下滑① 预览露出工作台顶部
        } else if (peek === PEEK_STOP) {
          setPeekTo(1, DUR_COMMIT, () => onEnterRef.current()); // 末页下滑② 掭到离场→提交
        }
      } else {
        if (pageIndex === 4 && peek > 0) {
          setPeekTo(0, DUR_RETRACT); // 预览态上滑 退回 CTA、工作台重新隐去
        } else if (pageIndex > 0) {
          gotoPage(pageIndex - 1);
        }
        // 首页上滑：无动作（不进入 animating）
      }
    };

    // 把 line(1)/page(2) 模式的 deltaY 归一到像素，避免某些鼠标/系统下阈值失真
    const normDelta = (e: WheelEvent): number =>
      e.deltaMode === 1
        ? e.deltaY * 16
        : e.deltaMode === 2
          ? e.deltaY * window.innerHeight
          : e.deltaY;

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      restartArmTimer(); // 每个 wheel 都重启 → 连续滚动期间永远回不到 idle，只翻一页
      if (phase !== "idle") {
        return;
      }
      wheelAccum += normDelta(e);
      if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) {
        return;
      }
      const dir = Math.sign(wheelAccum);
      wheelAccum = 0;
      dispatch(dir);
    };

    const NEXT = new Set(["ArrowDown", "ArrowRight", "PageDown", " ", "Spacebar"]);
    const PREV = new Set(["ArrowUp", "ArrowLeft", "PageUp"]);
    const onKey = (e: KeyboardEvent): void => {
      // Home/End 仅在非 peek 态生效（peek>0 时跳页会与掭起状态错位）
      if (e.key === "Home") {
        e.preventDefault();
        if (phase === "idle" && peek === 0 && pageIndex > 0) {
          gotoPage(0);
        }
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        if (phase === "idle" && peek === 0 && pageIndex < 4) {
          gotoPage(4);
        }
        return;
      }
      const isNext = NEXT.has(e.key);
      const isPrev = PREV.has(e.key);
      if (!isNext && !isPrev) {
        return;
      }
      e.preventDefault();
      if (e.repeat || phase !== "idle") {
        return; // 忽略按住重复 → 一次物理按键一页
      }
      dispatch(isNext ? 1 : -1);
    };

    let touchY = 0;
    const onTouchStart = (e: TouchEvent): void => {
      touchY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent): void => {
      e.preventDefault(); // 阻断原生滚动 / iOS 橡皮筋
    };
    const onTouchEnd = (e: TouchEvent): void => {
      const dy = touchY - e.changedTouches[0].clientY; // 上滑 dy>0（下一页），下滑 dy<0（上一页）
      if (Math.abs(dy) >= TOUCH_THRESHOLD) {
        dispatch(Math.sign(dy));
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      if (armTimer) {
        window.clearTimeout(armTimer);
      }
      cancelRaf();
      setP(0);
      setPeek(0);
    };
  }, []); // 依赖恒空：监听只挂一次；onEnter 经 onEnterRef 取最新值
}
