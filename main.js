import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const container = document.getElementById("canvas-container");
const tooltip = document.getElementById("tooltip");
const sparkleLayer = document.getElementById("sparkle-layer");
const infoPanel = document.getElementById("info-panel");
const infoTitle = document.getElementById("info-title");
const infoContent = document.getElementById("info-content");
const infoLink = document.getElementById("info-link");
const closeInfoButton = document.getElementById("close-info");
const clusterControls = document.getElementById("cluster-controls");
const clusterButtons = document.getElementById("cluster-buttons");
const resetFocusButton = document.getElementById("reset-focus");

let renderer, scene, camera, controls, points, basePointSize;
let highlightPoint, highlightMaterial;
let highlightStartTime = 0;
let highlightBoost = 1;
let lastHoveredIndex = null;
let lastSparkleTime = 0;
let lastFrameTime = 0;
let glowAttribute = null;
let glowNeedsDecay = false;
let baseColorArray = null;
let clusterMeta = new Map();
let focusedCluster = null;
let fullBoundingSphere = null;

const HIGHLIGHT_DURATION = 960;
const SPARKLE_INTERVAL = 14;
const FOCUS_FADE_FACTOR = 0.06;
const FOCUS_EMPHASIS_FACTOR = 1.25;
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 1;

init();
loadData();

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050817);

  const fov = 45;
  const aspect = container.clientWidth / container.clientHeight;
  const near = 0.1;
  const far = 1000;
  camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(30, 25, 35);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.minDistance = 10;
  controls.maxDistance = 120;
  controls.target.set(0, 0, 0);
  controls.update();

  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0x60a5fa, 0.6);
  directional.position.set(10, 20, 15);
  scene.add(directional);

  const gradientPlane = createGradientPlane();
  scene.add(gradientPlane);

  window.addEventListener("resize", onWindowResize);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerleave", hideTooltip);
  container.addEventListener("click", onClick);
  closeInfoButton.addEventListener("click", hideInfoPanel);
  if (resetFocusButton) {
    resetFocusButton.addEventListener("click", resetFocusView);
    resetFocusButton.disabled = true;
  }

  animate();
}

async function loadData() {
  try {
    const response = await fetch("assets/data/sample.jsonl");
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }

    const text = await response.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const pointsData = lines.map((line) => JSON.parse(line));
    createPointCloud(pointsData);
  } catch (error) {
    console.error(error);
    tooltip.textContent = "Failed to load data";
    tooltip.classList.remove("hidden");
    tooltip.classList.add("visible");
  }
}

function createPointCloud(data) {
  if (!data.length) return;

  const positions = new Float32Array(data.length * 3);
  const colors = new Float32Array(data.length * 3);
  const pulseSeeds = new Float32Array(data.length);
  const glowStrengths = new Float32Array(data.length);
  const clusterColor = createClusterColorMap(data.map((item) => item["Cluster"]));

  let i = 0;
  const userData = [];

  data.forEach((item, index) => {
    const x = item["t-SNE Component 1"];
    const y = item["t-SNE Component 2"];
    const z = item["t-SNE Component 3"];

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const color = new THREE.Color(clusterColor(item["Cluster"]));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    pulseSeeds[i] = Math.random() * Math.PI * 2;
    glowStrengths[i] = 0;

    userData.push({
      index,
      cluster: item["Cluster"],
      label: item["Descriptive_Cluster_Label"],
      original: item["Original String"],
      chopped: item["Original String Chopped"],
      link: item["URL"],
    });

    i += 1;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("pulseSeed", new THREE.BufferAttribute(pulseSeeds, 1));
  geometry.setAttribute(
    "glowStrength",
    new THREE.BufferAttribute(glowStrengths, 1).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.getAttribute("color").setUsage(THREE.DynamicDrawUsage);
  geometry.center();
  geometry.computeBoundingSphere();

  const scaledSize = 120 / Math.sqrt(data.length);
  basePointSize = Math.min(Math.max(scaledSize, 3.5), 40);

  const sprite = createPointSprite();

  const fadeDistance = geometry.boundingSphere
    ? Math.max(geometry.boundingSphere.radius * 3.2, 40)
    : 80;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: basePointSize },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uSprite: { value: sprite },
      uFadeDistance: { value: fadeDistance },
      uGlowBoost: { value: 1.8 },
      uMinFade: { value: 0.32 },
      uPulseAmp: { value: 0.28 },
    },
    vertexShader: `
      attribute vec3 color;
      attribute float pulseSeed;
      attribute float glowStrength;
      varying vec3 vColor;
      varying float vDistance;
      varying float vGlow;
      uniform float uTime;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uPulseAmp;

      void main() {
        vColor = color;
        vGlow = glowStrength;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vDistance = length(mvPosition.xyz);

        float pulse = sin(uTime + pulseSeed);
        float size = uSize * (1.0 + uPulseAmp * pulse);
        size = max(size, uSize * 0.65);

        float perspectiveScale = 45.0 / max(0.0001, -mvPosition.z);
        gl_PointSize = clamp(uPixelRatio * size * perspectiveScale, 2.0, 160.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vDistance;
      varying float vGlow;
      uniform sampler2D uSprite;
      uniform float uFadeDistance;
      uniform float uGlowBoost;
      uniform float uMinFade;

      void main() {
        vec2 uv = gl_PointCoord;
        vec4 spriteSample = texture2D(uSprite, uv);
        if (spriteSample.a < 0.05) discard;

        float fade = clamp(1.0 - (vDistance / uFadeDistance), 0.0, 1.0);
        float depthStrength = mix(uMinFade, 1.0, pow(fade, 1.1));
        float glow = clamp(vGlow, 0.0, 1.25);

        vec3 spriteTint = mix(vec3(1.0), spriteSample.rgb, 0.65);
        vec3 baseColor = vColor * spriteTint * depthStrength;
        vec3 glowColor = vColor * spriteSample.a * (0.35 + uGlowBoost * glow);

        vec3 finalColor = baseColor + glowColor;
        float alpha = spriteSample.a * clamp(depthStrength + glow * 0.55, 0.25, 1.0);

        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  baseColorArray = Float32Array.from(colors);
  points = new THREE.Points(geometry, material);
  points.userData = userData;
  scene.add(points);

  createHighlightPoint(sprite);

  glowAttribute = geometry.getAttribute("glowStrength");
  glowNeedsDecay = false;

  raycaster.params.Points.threshold = Math.max(basePointSize * 1.35, 0.35);

  if (geometry.boundingSphere) {
    fullBoundingSphere = geometry.boundingSphere.clone();
    frameScene(fullBoundingSphere);
  }

  focusedCluster = null;
  computeClusterMeta(geometry, userData);
  populateClusterControls();
}

function frameScene(boundingSphere) {
  const { center, radius } = boundingSphere;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const offset = Math.max(safeRadius * 2.5, 12);
  const focusPoint = center ?? new THREE.Vector3();

  controls.target.copy(focusPoint);

  const direction = new THREE.Vector3(1, 0.8, 1).normalize();
  const newPosition = direction.multiplyScalar(offset).add(focusPoint);
  camera.position.copy(newPosition);
  camera.near = Math.max(0.1, safeRadius * 0.02);
  camera.far = Math.max(offset * 10, safeRadius * 10, 500);
  camera.updateProjectionMatrix();
  camera.lookAt(focusPoint);

  controls.minDistance = Math.max(safeRadius * 0.5, 2);
  controls.maxDistance = Math.max(offset * 3, controls.minDistance + 10);
  controls.update();
}

function createClusterColorMap(clusters) {
  const uniqueClusters = [...new Set(clusters)];
  const colorCache = new Map();
  const goldenRatio = 0.618033988749895;
  let hue = Math.random();

  uniqueClusters.forEach((cluster) => {
    hue = (hue + goldenRatio) % 1;
    const color = new THREE.Color().setHSL(hue, 0.55, 0.55);
    colorCache.set(cluster, color.getHex());
  });

  return (cluster) => colorCache.get(cluster) ?? 0xffffff;
}

function sortClusterKeys(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aValid = Number.isFinite(aNum);
  const bValid = Number.isFinite(bNum);

  if (aValid && bValid) {
    return aNum - bNum;
  }

  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function computeClusterMeta(geometry, metadata) {
  clusterMeta = new Map();
  if (!geometry || !metadata || metadata.length === 0) {
    return;
  }

  const positionAttr = geometry.getAttribute("position");
  const colorAttr = geometry.getAttribute("color");
  if (!positionAttr) {
    return;
  }

  const buckets = new Map();
  metadata.forEach((meta, index) => {
    const rawCluster =
      meta.cluster ?? meta.Cluster ?? meta["Cluster"] ?? "Unlabeled";
    const clusterId = String(rawCluster);
    if (!buckets.has(clusterId)) {
      buckets.set(clusterId, {
        indices: [],
        label: meta.label ?? null,
        rawValue: rawCluster,
      });
    }
    const bucket = buckets.get(clusterId);
    bucket.indices.push(index);
    if (!bucket.label && meta.label) {
      bucket.label = meta.label;
    }
  });

  const scratch = new THREE.Vector3();

  buckets.forEach((bucket, clusterId) => {
    if (!bucket.indices.length) return;

    const center = new THREE.Vector3();
    bucket.indices.forEach((idx) => {
      scratch.fromBufferAttribute(positionAttr, idx);
      center.add(scratch);
    });
    center.multiplyScalar(1 / bucket.indices.length);

    let radiusSq = 0;
    bucket.indices.forEach((idx) => {
      scratch.fromBufferAttribute(positionAttr, idx);
      const distSq = scratch.distanceToSquared(center);
      if (distSq > radiusSq) {
        radiusSq = distSq;
      }
    });

    const color = new THREE.Color();
    if (colorAttr && bucket.indices.length > 0) {
      const i0 = bucket.indices[0];
      color.setRGB(
        colorAttr.getX(i0),
        colorAttr.getY(i0),
        colorAttr.getZ(i0)
      );
    }

    clusterMeta.set(clusterId, {
      indices: bucket.indices,
      indexSet: new Set(bucket.indices),
      center,
      radius: Math.sqrt(radiusSq),
      color,
      label: bucket.label ?? null,
      rawValue: bucket.rawValue,
    });
  });
}

function populateClusterControls() {
  if (!clusterControls || !clusterButtons) return;

  clusterButtons.innerHTML = "";

  if (!clusterMeta || clusterMeta.size === 0) {
    clusterControls.classList.add("is-hidden");
    if (resetFocusButton) {
      resetFocusButton.classList.add("is-hidden");
      resetFocusButton.disabled = true;
    }
    return;
  }

  const entries = Array.from(clusterMeta.entries()).sort((a, b) =>
    sortClusterKeys(a[1].rawValue ?? a[0], b[1].rawValue ?? b[0])
  );

  entries.forEach(([clusterId, meta]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cluster-button";
    button.dataset.cluster = String(clusterId);

    const labelSuffix = meta.label ? ` · ${meta.label}` : "";
    const displayCluster = meta.rawValue ?? clusterId;

    const swatch = document.createElement("span");
    swatch.className = "cluster-dot";
    swatch.style.setProperty("--dot-color", meta.color.getStyle());

    const label = document.createElement("span");
    label.textContent = `Cluster ${displayCluster}${labelSuffix}`;

    button.append(swatch, label);

    button.addEventListener("click", () => focusCluster(clusterId));
    clusterButtons.appendChild(button);
  });

  clusterControls.classList.remove("is-hidden");
  if (resetFocusButton) {
    resetFocusButton.classList.add("is-hidden");
    resetFocusButton.disabled = true;
  }
  setActiveClusterButton(null);
}

function focusCluster(clusterId) {
  if (!points) return;

  const id = String(clusterId);
  const meta = clusterMeta.get(id);
  if (!meta) return;

  if (focusedCluster === id) {
    resetFocusView();
    return;
  }

  focusedCluster = id;
  applyClusterFade(meta);
  hideTooltip();

  if (highlightPoint) {
    highlightPoint.visible = false;
  }

  const radius = Number.isFinite(meta.radius) && meta.radius > 0 ? meta.radius : 1;
  const paddedRadius = Math.max(radius * 1.8, basePointSize * 12, 6);
  const focusSphere = new THREE.Sphere(meta.center.clone(), paddedRadius);
  frameScene(focusSphere);

  controls.autoRotate = false;
  setActiveClusterButton(id);

  if (resetFocusButton) {
    resetFocusButton.classList.remove("is-hidden");
    resetFocusButton.disabled = false;
  }
}

function resetFocusView() {
  if (!points) return;

  focusedCluster = null;
  restoreBaseColors();
  setActiveClusterButton(null);
  hideTooltip();

  if (highlightPoint) {
    highlightPoint.visible = false;
  }

  controls.autoRotate = true;

  if (fullBoundingSphere) {
    frameScene(fullBoundingSphere);
  }

  if (resetFocusButton) {
    resetFocusButton.classList.add("is-hidden");
    resetFocusButton.disabled = true;
  }
}

function applyClusterFade(meta) {
  const colorAttr = points.geometry.getAttribute("color");
  if (!colorAttr || !baseColorArray) return;

  const array = colorAttr.array;
  const count = colorAttr.count;

  for (let i = 0; i < count; i += 1) {
    const baseIndex = i * 3;
    const baseR = baseColorArray[baseIndex];
    const baseG = baseColorArray[baseIndex + 1];
    const baseB = baseColorArray[baseIndex + 2];

    const isFocused = meta.indexSet.has(i);
    const factor = isFocused ? FOCUS_EMPHASIS_FACTOR : FOCUS_FADE_FACTOR;

    array[baseIndex] = clamp01(baseR * factor);
    array[baseIndex + 1] = clamp01(baseG * factor);
    array[baseIndex + 2] = clamp01(baseB * factor);
  }

  colorAttr.needsUpdate = true;
  if (points.material) {
    points.material.needsUpdate = true;
  }
}

function restoreBaseColors() {
  const colorAttr = points?.geometry?.getAttribute("color");
  if (!colorAttr || !baseColorArray) return;

  colorAttr.array.set(baseColorArray);
  colorAttr.needsUpdate = true;

  if (points.material) {
    points.material.needsUpdate = true;
  }
}

function setActiveClusterButton(clusterId) {
  if (!clusterButtons) return;
  const buttons = clusterButtons.querySelectorAll(".cluster-button");
  const target = clusterId !== null ? String(clusterId) : null;

  buttons.forEach((button) => {
    if (target && button.dataset.cluster === target) {
      button.classList.add("active");
    } else {
      button.classList.remove("active");
    }
  });
}

function clamp01(value) {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function createPointSprite() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.48
  );

  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.2, "rgba(255, 255, 255, 0.95)");
  gradient.addColorStop(0.5, "rgba(226, 232, 240, 0.4)");
  gradient.addColorStop(1, "rgba(15, 23, 42, 0)");

  context.fillStyle = gradient;
  context.beginPath();
  context.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}

function createGradientPlane() {
  const geometry = new THREE.PlaneGeometry(200, 200, 1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color1: { value: new THREE.Color(0x1e293b) },
      color2: { value: new THREE.Color(0x020617) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 color1;
      uniform vec3 color2;
      void main() {
        float mixStrength = smoothstep(0.0, 1.0, vUv.y);
        vec3 color = mix(color1, color2, mixStrength);
        gl_FragColor = vec4(color, 0.6);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const plane = new THREE.Mesh(geometry, material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -25;
  return plane;
}

function onWindowResize() {
  const { clientWidth, clientHeight } = container;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);

  if (points?.material?.uniforms?.uPixelRatio) {
    points.material.uniforms.uPixelRatio.value = Math.min(
      window.devicePixelRatio,
      2
    );
  }
}

function onPointerMove(event) {
  const bounds = container.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  updateTooltip(event.clientX, event.clientY);
  spawnSparkle(event.clientX, event.clientY);
}

function onClick(event) {
  if (!points) return;

  const bounds = container.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObject(points);

  if (intersects.length > 0) {
    const intersection = intersects[0];
    const { index } = intersection;
    triggerHighlight(intersection, { boost: 1.35 });
    boostGlow(index, 1.25);
    lastHoveredIndex = index;
    const metadata = points.userData[index];
    showInfoPanel(metadata);
  }
}

function showInfoPanel(metadata) {
  infoPanel.classList.remove("hidden");
  const title = metadata.label
    ? `Cluster ${metadata.cluster} · ${metadata.label}`
    : `Cluster ${metadata.cluster}`;
  infoTitle.textContent = title;
  infoContent.textContent = metadata.original ?? metadata.chopped ?? "";

  if (metadata.link) {
    infoLink.textContent = "Open linked resource";
    infoLink.href = metadata.link;
    infoLink.classList.remove("hidden");
  } else {
    infoLink.textContent = "";
    infoLink.href = "#";
    infoLink.classList.add("hidden");
  }
}

function hideInfoPanel() {
  infoPanel.classList.add("hidden");
}

function updateTooltip(clientX, clientY) {
  if (!points) return;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObject(points);

  if (intersects.length > 0) {
    const intersection = intersects[0];
    const { index } = intersection;
    const metadata = points.userData[index];
    const labelSuffix = metadata.label ? ` · ${metadata.label}` : "";
    const summary = escapeHtml(metadata.chopped ?? metadata.original ?? "");
    const formattedSummary = summary.replace(/\n/g, "<br />");
    tooltip.innerHTML = `<strong>Cluster ${metadata.cluster}${labelSuffix}</strong><br /><span>${formattedSummary}</span>`;
    tooltip.style.left = `${clientX + 16}px`;
    tooltip.style.top = `${clientY + 16}px`;
    tooltip.classList.remove("hidden");
    tooltip.classList.add("visible");

    triggerHighlight(intersection);
    lastHoveredIndex = index;
  } else {
    tooltip.classList.add("hidden");
    tooltip.classList.remove("visible");
    lastHoveredIndex = null;
  }
}

function hideTooltip() {
  tooltip.classList.add("hidden");
  tooltip.classList.remove("visible");
  lastHoveredIndex = null;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function animate(time = 0) {
  requestAnimationFrame(animate);

  const delta = lastFrameTime ? (time - lastFrameTime) / 1000 : 0.016;
  lastFrameTime = time;

  if (points) {
    points.rotation.y += 0.00028;
    const material = points.material;
    if (material && material.uniforms) {
      material.uniforms.uTime.value = time * 0.0016;
    }

    if (glowAttribute && glowNeedsDecay) {
      const array = glowAttribute.array;
      let anyActive = false;
      let needsUpdate = false;
      const decay = delta * 2.4;
      for (let i = 0; i < array.length; i += 1) {
        const value = array[i];
        if (value > 0.001) {
          const next = Math.max(0, value - decay);
          if (next !== value) {
            array[i] = next;
            needsUpdate = true;
          }
          if (next > 0.001) {
            anyActive = true;
          }
        }
      }
      if (needsUpdate) {
        glowAttribute.needsUpdate = true;
      }
      glowNeedsDecay = anyActive;
    }
  }

  updateHighlight();
  controls.update();
  renderer.render(scene, camera);
}

function createHighlightPoint(sprite) {
  if (highlightPoint) {
    scene.remove(highlightPoint);
    highlightPoint.geometry.dispose();
    highlightMaterial.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0], 3)
  );

  const initialHighlightSize = Math.max(basePointSize * 1.4, basePointSize + 2.5);
  highlightMaterial = new THREE.PointsMaterial({
    size: initialHighlightSize,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: sprite,
    alphaMap: sprite,
    alphaTest: 0.05,
    color: new THREE.Color(0xffffff),
  });

  highlightPoint = new THREE.Points(geometry, highlightMaterial);
  highlightPoint.visible = false;
  scene.add(highlightPoint);
}

function boostGlow(index, strength = 1) {
  if (!glowAttribute) return;
  if (index < 0 || index >= glowAttribute.count) return;

  const array = glowAttribute.array;
  const target = Math.min(1.35, Math.max(strength, array[index]));
  if (array[index] !== target) {
    array[index] = target;
    glowAttribute.needsUpdate = true;
  }
  glowNeedsDecay = true;
}

function triggerHighlight(intersection, options = {}) {
  if (!highlightPoint || !highlightMaterial || !points) return;

  const { index, point } = intersection;
  const { boost = 1 } = options;
  highlightPoint.position.copy(point);

  const colorAttr = points.geometry.getAttribute("color");
  if (colorAttr && typeof colorAttr.getX === "function") {
    const r = colorAttr.getX(index);
    const g = colorAttr.getY(index);
    const b = colorAttr.getZ(index);
    highlightMaterial.color.setRGB(r, g, b);
  }

  highlightStartTime = performance.now();
  highlightBoost = Math.max(1, boost);
  const activeHighlightSize = Math.max(basePointSize * 1.6, basePointSize + 3);
  highlightMaterial.size = activeHighlightSize * highlightBoost;
  highlightMaterial.opacity = 1;
  highlightPoint.visible = true;

  boostGlow(index, 1.05 * highlightBoost);
}

function updateHighlight() {
  if (!highlightPoint || !highlightPoint.visible) return;

  const now = performance.now();
  const elapsed = now - highlightStartTime;

  if (elapsed >= HIGHLIGHT_DURATION) {
    highlightPoint.visible = false;
    return;
  }

  const progress = elapsed / HIGHLIGHT_DURATION;
  const fade = 1 - progress;
  const pulse = 1 + Math.sin(progress * Math.PI) * 0.85;
  highlightMaterial.opacity = fade;
  const pulseBase = Math.max(basePointSize * 1.35, basePointSize + 2.2);
  highlightMaterial.size = pulseBase * pulse * Math.max(1, highlightBoost * 0.75);
}

function spawnSparkle(x, y) {
  if (!sparkleLayer) return;

  const now = performance.now();
  if (now - lastSparkleTime < SPARKLE_INTERVAL) return;
  lastSparkleTime = now;

  const burstCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < burstCount; i += 1) {
    const sparkle = document.createElement("span");
    sparkle.className = "sparkle";
    const offsetX = x + (Math.random() - 0.5) * 32;
    const offsetY = y + (Math.random() - 0.5) * 32;
    sparkle.style.left = `${offsetX}px`;
    sparkle.style.top = `${offsetY}px`;

    const hue = Math.floor(180 + Math.random() * 140);
    const saturation = 70 + Math.random() * 30;
    const lightness = 62 + Math.random() * 26;
    const accentHue = (hue + 30 + Math.random() * 50) % 360;
    const size = 8 + Math.random() * 20;
    sparkle.style.setProperty(
      "--sparkle-color",
      `hsla(${hue}, ${saturation}%, ${lightness}%, 0.95)`
    );
    sparkle.style.setProperty(
      "--sparkle-accent",
      `hsla(${accentHue}, ${Math.min(95, saturation + 10)}%, ${Math.min(
        85,
        lightness + 8
      )}%, 0.85)`
    );
    sparkle.style.setProperty("--sparkle-size", `${size}px`);
    sparkle.style.setProperty(
      "--sparkle-rotation",
      `${Math.random() * 360}deg`
    );
    sparkle.style.animationDelay = `${Math.random() * 0.12}s`;

    sparkleLayer.appendChild(sparkle);
    sparkle.addEventListener("animationend", () => {
      sparkle.remove();
    });
  }
}
