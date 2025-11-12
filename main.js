import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const container = document.getElementById("canvas-container");
const tooltip = document.getElementById("tooltip");
const infoPanel = document.getElementById("info-panel");
const infoTitle = document.getElementById("info-title");
const infoContent = document.getElementById("info-content");
const infoLink = document.getElementById("info-link");
const closeInfoButton = document.getElementById("close-info");

let renderer, scene, camera, controls, points, basePointSize;
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
  geometry.center();
  geometry.computeBoundingSphere();

  basePointSize = Math.max(0.4, 90 / Math.sqrt(data.length));

  const sprite = createPointSprite();

  const material = new THREE.PointsMaterial({
    size: basePointSize,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: true,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    map: sprite,
    alphaMap: sprite,
    alphaTest: 0.1,
  });

  points = new THREE.Points(geometry, material);
  points.userData = userData;
  scene.add(points);

  raycaster.params.Points.threshold = Math.max(basePointSize * 0.85, 0.8);

  if (geometry.boundingSphere) {
    frameScene(geometry.boundingSphere);
  }
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
}

function onPointerMove(event) {
  const bounds = container.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  updateTooltip(event.clientX, event.clientY);
}

function onClick(event) {
  if (!points) return;

  const bounds = container.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObject(points);

  if (intersects.length > 0) {
    const { index } = intersects[0];
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
    const { index } = intersects[0];
    const metadata = points.userData[index];
    const labelSuffix = metadata.label ? ` · ${metadata.label}` : "";
    const summary = escapeHtml(metadata.chopped ?? metadata.original ?? "");
    const formattedSummary = summary.replace(/\n/g, "<br />");
    tooltip.innerHTML = `<strong>Cluster ${metadata.cluster}${labelSuffix}</strong><br /><span>${formattedSummary}</span>`;
    tooltip.style.left = `${clientX + 16}px`;
    tooltip.style.top = `${clientY + 16}px`;
    tooltip.classList.remove("hidden");
    tooltip.classList.add("visible");
  } else {
    tooltip.classList.add("hidden");
    tooltip.classList.remove("visible");
  }
}

function hideTooltip() {
  tooltip.classList.add("hidden");
  tooltip.classList.remove("visible");
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
  if (points) {
    const material = points.material;
    const pulsate = 0.2 * Math.sin(time * 0.0006);
    material.size = basePointSize + pulsate;
    points.rotation.y += 0.0004;
  }
  controls.update();
  renderer.render(scene, camera);
}
