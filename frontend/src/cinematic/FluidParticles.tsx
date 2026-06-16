import { useMemo, useRef } from "react";
import { extend, useFrame, type ReactThreeFiber } from "@react-three/fiber";
import { shaderMaterial } from "@react-three/drei";
import * as THREE from "three";

import { useCinematicStore } from "../store/cinematic";

/**
 * GPU 流体发光粒子（§12-①「粒子走 GPU，禁 CPU」硬要求）：
 * - <points> + 自定义 <shaderMaterial>；curl/perlin 位移逻辑全部写在 GLSL vertex shader。
 * - useFrame 只递增 uTime uniform，位移在 GPU 侧计算——绝不在 CPU 遍历几万点 BufferAttribute。
 * - 加法混合 + 发光核心，让 ACESFilmic + mipmapBlur Bloom「吃」到泛光。
 */

const PARTICLE_COUNT = 28000;

/** Ashima Arts / Stefan Gustavson 3D simplex 噪声（MIT，公有手法）+ curl 旋度场，纯 GPU 计算 */
const NOISE_GLSL = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute( permute( permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

vec3 snoiseVec3(vec3 x){
  float s  = snoise(x);
  float s1 = snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2));
  float s2 = snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4));
  return vec3(s, s1, s2);
}

vec3 curlNoise(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  vec3 p_x0 = snoiseVec3(p - dx);
  vec3 p_x1 = snoiseVec3(p + dx);
  vec3 p_y0 = snoiseVec3(p - dy);
  vec3 p_y1 = snoiseVec3(p + dy);
  vec3 p_z0 = snoiseVec3(p - dz);
  vec3 p_z1 = snoiseVec3(p + dz);

  float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
  float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
  float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;

  const float divisor = 1.0 / (2.0 * e);
  return normalize(vec3(x, y, z) * divisor);
}
`;

const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uAmplitude;
uniform float uNoiseScale;
uniform float uFlowSpeed;
uniform float uVisible;
uniform float uMorph;
attribute float aRandom;
attribute float aSeed;
varying float vIntensity;
varying float vKeep;
varying float vForm;

${NOISE_GLSL}

// 钟形幕权重：在 [a,b] 升起、在 [c,d] 落下，其余为 0（与 Scene.tsx 的 bell() 同窗口）
float bell(float x, float a, float b, float c, float d){
  return smoothstep(a, b, x) * (1.0 - smoothstep(c, d, x));
}

void main() {
  // —— 分幕权重（=scrollProgress 驱动；窗口对齐文字 crossfade）——
  // 每幕用一个「明确的目标形态」，权重 0→1→0；Hero/幕间回到平静球壳，CTA 收束成核。
  float m = uMorph;
  float wEye  = bell(m, 0.17, 0.27, 0.38, 0.47);  // Act2a 眼/虹膜
  float wWave = bell(m, 0.42, 0.50, 0.58, 0.65);  // Act2b 声波
  float wFlow = bell(m, 0.59, 0.67, 0.77, 0.83);  // Act2c 数据流
  float wCta  = smoothstep(0.82, 0.93, m);        // Act3 收束成核
  float formW = max(max(wEye, wWave), max(wFlow, wCta));

  vec3 base = position;

  // 缓慢绕 Y 整体旋流，给球壳一个公转；某幕成形时减弱旋流，让形态读得清
  float ang = uTime * 0.06 * (1.0 - 0.6 * formW);
  float ca = cos(ang);
  float sa = sin(ang);
  base.xz = mat2(ca, -sa, sa, ca) * base.xz;

  // curl 旋度场位移（GPU 计算）；成形时降幅 -> 球壳保留湍流、各幕形态干净可辨
  vec3 flow = curlNoise(base * uNoiseScale + vec3(0.0, uTime * uFlowSpeed * 0.08, 0.0));
  float curlAmp = uAmplitude * (0.6 + aRandom * 0.8) * (1.0 - 0.75 * formW);
  vec3 sphere = base + flow * curlAmp;

  // —— 各幕的显式目标形态（用稳定的原始 position + 解耦随机 aSeed 计算，与裁剪用的 aRandom 互不影响）——
  float theta = atan(position.y, position.x);   // 球面采样的均匀角
  float seed = aSeed;

  // 眼/虹膜：正对相机的薄盘，5 圈同心环 + 放射状纤维 + 中心瞳孔空洞
  float eyeAng = theta + uTime * 0.04;
  float ring = floor(seed * 5.0) * 0.45;                 // 5 圈同心环（瞳孔留空）
  float eyeR = 1.25 + ring + 0.12 * sin(eyeAng * 22.0);  // 放射纤维
  float eyeZ = (seed - 0.5) * 0.30;                      // 极薄 -> 正对相机
  vec3 eyePos = vec3(cos(eyeAng) * eyeR, sin(eyeAng) * eyeR, eyeZ);

  // 声波：水平大盘(xz)，y 随半径做向外滚动的同心波（双频叠加）
  float waveR = 0.5 + sqrt(seed) * 6.8;
  float ripple = sin(waveR * 1.5 - uTime * 2.6) * 0.95
               + sin(waveR * 0.7 - uTime * 1.3) * 0.35;
  vec3 wavePos = vec3(cos(theta) * waveR, ripple, sin(theta) * waveR);

  // 数据流：绕 z 轴的管状隧道，粒子沿 +z 朝相机贯穿（mod 循环成无尽流）
  float tubeR = 0.7 + seed * 2.7;
  float flowAng = theta + uTime * 0.12;
  float span = 18.0;
  float zStream = mod(seed * span + uTime * 4.2, span) - span * 0.5;
  vec3 flowPos = vec3(cos(flowAng) * tubeR, sin(flowAng) * tubeR, zStream);

  // CTA：朝中心轻柔汇聚成小核
  vec3 corePos = normalize(position) * (0.35 + seed * 1.35);

  // 自平静球壳依权重混合到各幕形态（窗口近乎互斥，顺序 mix 即平滑过场）
  vec3 pos = sphere;
  pos = mix(pos, eyePos,  wEye);
  pos = mix(pos, wavePos, wWave);
  pos = mix(pos, flowPos, wFlow);
  pos = mix(pos, corePos, wCta);

  vIntensity = clamp(length(flow) * 0.6, 0.0, 1.0);
  vForm = formW;

  // —— 密度减量（用户头号反馈）：按可见阈值 uVisible 软裁剪——aRandom 超阈值的粒子点尺寸归零，
  // GPU 直接丢弃其片元（后幕真实减少渲染粒子数，不是只调暗）。窄过渡带避免阈值扫过时硬跳。
  vKeep = 1.0 - smoothstep(uVisible - 0.08, uVisible, aRandom);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // 数据流幕的点略大略亮，强化「流线」速度感
  float sizeBoost = 1.0 + 0.5 * wFlow;
  // 上限钳制：数据流幕粒子会贯穿相机平面（-mvz→0 时透视因子发散），钳到 48px 之上不超
  // （> 其余幕的自然上限 ~27px，故不影响 Hero/眼/声波），杜绝单点撑大叠加成白（沿用 P1 防白屏教训）。
  gl_PointSize = min(uSize * (0.5 + aRandom) * (220.0 / -mvPosition.z) * vKeep * sizeBoost, 48.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uOpacity;
uniform float uTone;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorDeep;
varying float vIntensity;
varying float vKeep;
varying float vForm;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);
  float alpha = smoothstep(0.5, 0.0, d);
  alpha = pow(alpha, 1.6);

  vec3 color = mix(uColorA, uColorB, vIntensity);
  // 提亮核心，让 Bloom 在近黑底上吃到强泛光；CTA(uTone↑) 时收敛核心更克制
  color += uColorB * pow(alpha, 3.0) * 0.6 * (1.0 - 0.45 * uTone);
  // 能力幕成形时（vForm↑）略提亮 -> 「聚焦感」；CTA 时不提亮
  color += uColorB * vForm * 0.12 * (1.0 - uTone);
  // CTA：整体压向最深一档强调色 -> 最暗最克制的收束氛围
  color = mix(color, uColorDeep, uTone * 0.55);

  // vKeep 同时作用于透明度：过渡带内的粒子柔和淡出，避免裁剪硬边
  gl_FragColor = vec4(color, alpha * uOpacity * vKeep);
}
`;

/** 自定义粒子材质的运行时形状（drei 为每个 uniform 在实例上挂 getter/setter） */
type FluidParticleMaterialImpl = THREE.ShaderMaterial & {
  uTime: number;
  uSize: number;
  uAmplitude: number;
  uNoiseScale: number;
  uFlowSpeed: number;
  uVisible: number;
  uMorph: number;
  uOpacity: number;
  uTone: number;
  uColorA: THREE.Color;
  uColorB: THREE.Color;
  uColorDeep: THREE.Color;
};

const FluidParticleMaterial = shaderMaterial(
  {
    uTime: 0,
    // 透视公式 gl_PointSize = uSize*(0.5+aRandom)*(220/-mvPos.z)：相机距粒子 ~2–16 → 透视因子 ~14–120，
    // 故 uSize 必须取小（~0.22）才得「细密发光微光点」；取大（旧值 26）会把单点撑到数千 px，
    // 28000 个 AdditiveBlending 精灵彼此叠加 → 整屏饱和成白、再叠 Bloom 全白。改值勿再放大。
    uSize: 0.22,
    uAmplitude: 1.15,
    uNoiseScale: 0.34,
    uFlowSpeed: 1,
    // uVisible：可见阈值，>1 时全可见。Hero 取 1.08（不裁剪任何粒子），后幕降至 ~0.25（裁掉约 3/4）。
    uVisible: 1.08,
    // uMorph：形态相位（=scrollProgress），驱动眼/声波/数据流/收束四态意象，Hero/幕间为平静球壳。
    uMorph: 0,
    uOpacity: 0.92,
    // uTone：色调档（0=亮 periwinkle，→1 压向最深一档强调色），CTA 幕拉高 -> 最暗最克制。
    uTone: 0,
    // 默认回退色（与 LiveBackdrop 的 periwinkle 回退一致）；运行时由 CSS 令牌覆盖
    uColorA: new THREE.Color("#9bb8e1"),
    uColorB: new THREE.Color("#b8cdee"),
    uColorDeep: new THREE.Color("#2c4e73"),
  },
  VERTEX_SHADER,
  FRAGMENT_SHADER,
);

extend({ FluidParticleMaterial });

// 为自定义元素补 JSX 类型（module augmentation），TS strict 下零 any
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      fluidParticleMaterial: ReactThreeFiber.MaterialNode<
        FluidParticleMaterialImpl,
        typeof FluidParticleMaterial
      >;
    }
  }
}

interface FluidParticlesProps {
  /** 粒子主色（CSS --color-accent 派生） */
  colorA: THREE.Color;
  /** 粒子高光/核心色（CSS --color-accent-strong 派生） */
  colorB: THREE.Color;
  /** 最深一档强调色（CSS --color-accent-deep 派生），CTA 幕压向它收束氛围 */
  colorDeep: THREE.Color;
}

/**
 * 作用：环绕 Hero 的 GPU 流体发光粒子云
 * 参数：colorA/colorB/colorDeep 来自 CSS 令牌的三档强调色
 * 返回：<points> + 自定义着色材质
 */
export function FluidParticles({ colorA, colorB, colorDeep }: FluidParticlesProps) {
  const materialRef = useRef<FluidParticleMaterialImpl>(null);

  // 仅生成一次属性数组；几何体/属性的生命周期交给 r3f 声明式管理（StrictMode 安全，无需手动 dispose）
  const attributes = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const randoms = new Float32Array(PARTICLE_COUNT);
    // aSeed：与 aRandom 解耦的第二随机（aRandom 专用于密度裁剪；aSeed 专用于各幕形态的半径/环/相位分布，
    // 二者独立 -> 后幕裁剪不会系统性偏掉形态的外圈）
    const seeds = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      // 外偏的球壳分布，包裹住居中的 Hero
      const radius = 3.2 + Math.sqrt(Math.random()) * 4.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const sinPhi = Math.sin(phi);
      positions[i * 3] = radius * sinPhi * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * sinPhi * Math.sin(theta);
      randoms[i] = Math.random();
      seeds[i] = Math.random();
    }
    return { positions, randoms, seeds };
  }, []);

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (material === null) {
      return;
    }
    // 唯一的每帧 CPU 工作：递增 uTime；所有位移在 GPU 顶点着色器里算
    material.uTime += delta;

    const { stage, scrollProgress } = useCinematicStore.getState();
    const workspace = stage === "workspace";
    // 工作台用 Hero-calm 相位（忽略残留滚动进度）；开场按真实滚动进度逐幕减量
    const p = workspace ? 0 : scrollProgress;

    // 密度逐幕减量（用户头号反馈：后幕避免「光污染」）：Hero 满（1.08，不裁剪）→ CTA 最稀（0.25，裁约 3/4）
    const visibleTarget = workspace
      ? 0.42
      : THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(p, 0.15, 0.85, 1.08, 0.25), 0.25, 1.08);
    material.uVisible = THREE.MathUtils.damp(material.uVisible, visibleTarget, 2.4, delta);

    // 不透明度同步逐幕降低（Hero 偏亮 → 后幕收敛）
    const opacityTarget = workspace ? 0.3 : THREE.MathUtils.lerp(0.95, 0.5, p);
    material.uOpacity = THREE.MathUtils.damp(material.uOpacity, opacityTarget, 2.4, delta);

    // 形态相位轻阻尼跟随滚动；工作台回到平静球壳
    material.uMorph = THREE.MathUtils.damp(material.uMorph, workspace ? 0 : p, 6, delta);

    // 色调档：能力幕保持亮 periwinkle，CTA 幕拉高 -> 压向最深一档色（最暗最克制）；工作台偏深
    const toneTarget = workspace
      ? 0.5
      : THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(p, 0.8, 0.95, 0, 0.85), 0, 0.85);
    material.uTone = THREE.MathUtils.damp(material.uTone, toneTarget, 2.4, delta);

    // 进入工作台后整体放慢流速（暗、慢、泛光自然减弱）
    material.uFlowSpeed = THREE.MathUtils.damp(material.uFlowSpeed, workspace ? 0.45 : 1, 2.4, delta);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[attributes.positions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[attributes.randoms, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[attributes.seeds, 1]} />
      </bufferGeometry>
      <fluidParticleMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uColorA={colorA}
        uColorB={colorB}
        uColorDeep={colorDeep}
      />
    </points>
  );
}
