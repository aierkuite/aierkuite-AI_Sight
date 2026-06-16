/**
 * 程序合成的低频氛围 drone（WebAudio，零音频资产、零版权、零下载）。
 *
 * 设计：3 个失谐正弦振荡器（A1 ~55Hz + 微失谐 + 五度）→ lowpass 滤波 → 主增益 → 输出；
 * 一个极慢 LFO（~0.06Hz）调制滤波器截止频率，制造缓慢起伏的「呼吸感」。
 *
 * 合规（plan §12-⑤）：`AudioContext` 必须在用户手势（SoundToggle 点击）里首次创建/`resume()`，
 * 滚动不算有效手势。故本模块只暴露命令式 API，由 SoundToggle 的 onClick 调用 start()。
 * 与 TTS 不抢：靠 stage 错开（氛围音仅 intro 播、进 workspace 即 stop/dispose），本模块不读任何 chat/TTS 状态。
 *
 * 全部使用标准 DOM 的 WebAudio 类型，无 any、无 as 强转。
 */

/** drone 的目标主音量（克制但在小喇叭上清晰可闻） */
const TARGET_GAIN = 0.16;
/** 淡入/淡出秒数 */
const FADE_SECONDS = 1.2;
/** dispose 时的淡出秒数（进入工作台时听感上仍是「淡出」而非硬切） */
const DISPOSE_FADE_SECONDS = 0.6;
/** 低音 drone 的三个频率：A2 + 微失谐拍频 + 上方五度 E3（可闻低音域，而非笔记本喇叭放不出的 sub-bass） */
const VOICE_FREQS = [110, 110.5, 164.81];

/** 氛围音控制器：命令式开/关/销毁；start() 必须由用户手势触发以满足自动播放策略 */
export interface AmbientDrone {
  /** 由按钮 onClick 调用：首次构建并 resume AudioContext（用户手势），随后淡入到目标音量 */
  start: () => void;
  /** 淡出到静音（保留 AudioContext，可再次 start 恢复） */
  stop: () => void;
  /** 淡出后彻底拆除：停止振荡器、断开节点、关闭 AudioContext（组件卸载时调用） */
  dispose: () => void;
}

/**
 * 作用：创建一个氛围 drone 控制器（惰性——调用 start() 前不创建 AudioContext，避免无手势触碰自动播放策略）
 * 参数：无
 * 返回：AmbientDrone 命令式控制器
 */
export function createAmbientDrone(): AmbientDrone {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const voices: OscillatorNode[] = [];
  let lfo: OscillatorNode | null = null;
  let disposed = false;

  /** 把主增益在 fade 秒内平滑斜坡到 target（先取消既有计划、锚定当前值，避免跳变） */
  function rampMaster(target: number, fade: number): void {
    if (ctx === null || master === null) {
      return;
    }
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(target, now + fade);
  }

  /** 惰性构建振荡器/滤波/LFO 图（仅首次 start 时调用） */
  function build(): void {
    const context = new AudioContext();

    const masterGain = context.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(context.destination);

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 820;
    filter.Q.value = 0.7;
    filter.connect(masterGain);

    for (const freq of VOICE_FREQS) {
      const osc = context.createOscillator();
      // 锯齿波富含谐波 -> 即便基频偏低，谐波也能在小喇叭上听见（纯正弦在低音域几乎不可闻）
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      const voiceGain = context.createGain();
      voiceGain.gain.value = 0.22;
      osc.connect(voiceGain);
      voiceGain.connect(filter);
      osc.start();
      voices.push(osc);
    }

    // 极慢 LFO 调制滤波器截止 -> 缓慢明暗起伏（在 ~520–1120Hz 间呼吸）
    const lfoOsc = context.createOscillator();
    lfoOsc.type = "sine";
    lfoOsc.frequency.value = 0.06;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 300;
    lfoOsc.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    lfoOsc.start();

    ctx = context;
    master = masterGain;
    lfo = lfoOsc;
  }

  return {
    start(): void {
      if (disposed) {
        return;
      }
      if (ctx === null) {
        build(); // 首次：在用户手势栈内构建
      }
      // resume 必须在用户手势内（plan §12-⑤）；对已运行的 context 再次 resume 是无害幂等
      void ctx?.resume();
      rampMaster(TARGET_GAIN, FADE_SECONDS);
    },

    stop(): void {
      if (disposed || ctx === null) {
        return;
      }
      rampMaster(0, FADE_SECONDS);
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      const context = ctx;
      if (context === null) {
        return; // 从未 start 过，无需拆除
      }
      // 先淡出再拆，进入工作台时听感是淡出而非硬切
      rampMaster(0, DISPOSE_FADE_SECONDS);
      const stopAt = context.currentTime + DISPOSE_FADE_SECONDS;
      for (const osc of voices) {
        osc.stop(stopAt);
      }
      lfo?.stop(stopAt);
      window.setTimeout(
        () => {
          void context.close();
        },
        (DISPOSE_FADE_SECONDS + 0.1) * 1000,
      );
      ctx = null;
      master = null;
      lfo = null;
    },
  };
}
