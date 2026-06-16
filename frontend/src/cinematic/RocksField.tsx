import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";

import { useCinematicStore } from "../store/cinematic";

const MODEL_URL = "/cinematic/models/rocks.glb";
const NORMAL_URL = "/cinematic/tex/waternormals.jpg";

/** 碎块群的目标视觉尺寸（世界单位）——作环境背景而非遮挡主体，故偏小并后置 */
const TARGET_SIZE = 6;

interface RocksFieldProps {
  /** 暗冷金属底色（CSS --color-accent-deep 派生） */
  baseColor: THREE.Color;
  /** 自发光色（CSS --color-accent 派生），配合 Bloom 形成微光 */
  emissiveColor: THREE.Color;
}

/**
 * 作用：钟形幕权重——在 [a,b] 升起、在 [c,d] 落下，其余为 0（与 Scene/FluidParticles 同窗口约定）。
 * 参数：x 进度；a/b 升起区间；c/d 落下区间
 * 返回：0–1 权重
 */
function bell(x: number, a: number, b: number, c: number, d: number): number {
  return THREE.MathUtils.smoothstep(x, a, b) * (1 - THREE.MathUtils.smoothstep(x, c, d));
}

/**
 * 作用：能力幕（Act2）的环境碎块——rocks.glb 归一化后缓慢旋转，waternormals 法线缓动滚动出
 *   「流动质感」。按 scrollProgress 在眼/声波两幕淡入参与构图（声波幕漂到右侧），数据流隧道幕前淡出停渲；
 *   Hero / CTA / 工作台不渲。纯装饰：只读 store 的 stage/scrollProgress 与 CSS 令牌派生色，绝不碰 chat/设备状态。
 * 参数：baseColor/emissiveColor 来自 CSS 令牌
 * 返回：受滚动驱动淡入淡出的碎块 group
 */
export function RocksField({ baseColor, emissiveColor }: RocksFieldProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(MODEL_URL);
  const normalMap = useTexture(NORMAL_URL);

  const material = useMemo(() => {
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: emissiveColor,
      emissiveIntensity: 0.22,
      metalness: 0.82,
      roughness: 0.5,
      normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
  }, [baseColor, emissiveColor, normalMap]);

  // 克隆 + 归一化（居中、缩放到目标尺寸）+ 统一材质
  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.material = material;
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    root.position.sub(center);

    const holder = new THREE.Group();
    holder.add(root);
    const maxDim = Math.max(size.x, size.y, size.z);
    holder.scale.setScalar(maxDim > 0 ? TARGET_SIZE / maxDim : 1);
    return holder;
  }, [scene, material]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (group === null) {
      return;
    }
    const { stage, scrollProgress } = useCinematicStore.getState();
    const workspace = stage === "workspace";
    const p = workspace ? 0 : scrollProgress;

    // 眼+声波两幕淡入参与构图（0.16→0.28 升起），数据流隧道幕前淡出（0.56→0.66）；其余幕停渲
    const inCap = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(p, 0.16, 0.28, 0, 1), 0, 1);
    const outCap = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(p, 0.56, 0.66, 1, 0), 0, 1);
    const cap = inCap * outCap;

    material.opacity = THREE.MathUtils.damp(material.opacity, cap * 0.7, 3, delta);
    group.visible = material.opacity > 0.01;

    // 声波幕把碎块漂到右下侧（让出中央波面）；眼幕则居中偏后作背景
    const wWave = bell(p, 0.42, 0.5, 0.58, 0.66);
    const driftX = THREE.MathUtils.lerp(-0.4, 3, wWave);
    const driftY = THREE.MathUtils.lerp(-0.5, -1.6, wWave);
    group.position.x = THREE.MathUtils.damp(group.position.x, driftX, 2.5, delta);
    group.position.y = THREE.MathUtils.damp(group.position.y, driftY, 2.5, delta);

    const t = state.clock.elapsedTime;
    group.rotation.y += delta * 0.08;
    group.rotation.x = Math.sin(t * 0.2) * 0.1;
    // 法线贴图缓慢滚动 → 表面流动质感（取模避免无限增长）
    normalMap.offset.y = (normalMap.offset.y + delta * 0.03) % 1;
  });

  return (
    <group ref={groupRef} position={[0, -0.5, -2.5]}>
      <primitive object={model} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
