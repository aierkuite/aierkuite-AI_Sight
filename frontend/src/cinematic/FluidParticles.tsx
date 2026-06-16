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
attribute float aRandom;
varying float vIntensity;

${NOISE_GLSL}

void main() {
  vec3 base = position;

  // 缓慢绕 Y 整体旋流，给粒子云一个公转
  float ang = uTime * 0.06;
  float ca = cos(ang);
  float sa = sin(ang);
  base.xz = mat2(ca, -sa, sa, ca) * base.xz;

  // curl 旋度场位移（GPU 计算），噪声场随时间向上滚动 -> 流体流动观感
  vec3 flow = curlNoise(base * uNoiseScale + vec3(0.0, uTime * uFlowSpeed * 0.08, 0.0));
  vec3 displaced = base + flow * uAmplitude * (0.6 + aRandom * 0.8);

  vIntensity = clamp(length(flow) * 0.6, 0.0, 1.0);

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize * (0.5 + aRandom) * (220.0 / -mvPosition.z);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vIntensity;

void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);
  float alpha = smoothstep(0.5, 0.0, d);
  alpha = pow(alpha, 1.6);

  vec3 color = mix(uColorA, uColorB, vIntensity);
  // 提亮核心，让 Bloom 在近黑底上吃到强泛光
  color += uColorB * pow(alpha, 3.0) * 0.6;

  gl_FragColor = vec4(color, alpha * uOpacity);
}
`;

/** 自定义粒子材质的运行时形状（drei 为每个 uniform 在实例上挂 getter/setter） */
type FluidParticleMaterialImpl = THREE.ShaderMaterial & {
  uTime: number;
  uSize: number;
  uAmplitude: number;
  uNoiseScale: number;
  uFlowSpeed: number;
  uOpacity: number;
  uColorA: THREE.Color;
  uColorB: THREE.Color;
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
    uOpacity: 0.92,
    // 默认回退色（与 LiveBackdrop 的 periwinkle 回退一致）；运行时由 CSS 令牌覆盖
    uColorA: new THREE.Color("#9bb8e1"),
    uColorB: new THREE.Color("#b8cdee"),
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
}

/**
 * 作用：环绕 Hero 的 GPU 流体发光粒子云
 * 参数：colorA/colorB 来自 CSS 令牌的两档强调色
 * 返回：<points> + 自定义着色材质
 */
export function FluidParticles({ colorA, colorB }: FluidParticlesProps) {
  const materialRef = useRef<FluidParticleMaterialImpl>(null);

  // 仅生成一次属性数组；几何体/属性的生命周期交给 r3f 声明式管理（StrictMode 安全，无需手动 dispose）
  const attributes = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const randoms = new Float32Array(PARTICLE_COUNT);
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
    }
    return { positions, randoms };
  }, []);

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (material === null) {
      return;
    }
    // 唯一的每帧 CPU 工作：递增 uTime；所有位移在 GPU 顶点着色器里算
    material.uTime += delta;

    // 进入工作台后整体降为低强度氛围（暗、慢、泛光自然减弱）
    const workspace = useCinematicStore.getState().stage === "workspace";
    material.uOpacity = THREE.MathUtils.damp(material.uOpacity, workspace ? 0.3 : 0.92, 2.4, delta);
    material.uFlowSpeed = THREE.MathUtils.damp(material.uFlowSpeed, workspace ? 0.45 : 1, 2.4, delta);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[attributes.positions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[attributes.randoms, 1]} />
      </bufferGeometry>
      <fluidParticleMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uColorA={colorA}
        uColorB={colorB}
      />
    </points>
  );
}
