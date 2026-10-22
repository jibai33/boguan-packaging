/* ==========================================================================
   博冠包装 · 工厂漫游（three.js）
   --------------------------------------------------------------------------
   设计要点
   1. 场景构建 buildFactory(THREE) 是纯 three 对象，不碰 DOM —— 可以在 Node 里
      直接 import 验证场景图、动画函数、相机路径，而不是"写完就交"。
   2. 第一人称观感：相机高度 1.62m、FOV 72、轻微手持抖动、鼠标拖拽可小幅转头。
   3. 分站式引导：四站对应工艺流程（纸卷 → 印刷 → 模切 → 码垛），
      相机沿 Catmull-Rom 路径平滑推进，比自由漫游更可控，移动端也能用。
   4. 降级：无 WebGL / prefers-reduced-motion / 页面离屏，都有对应处理。
   ========================================================================== */

/* ---------------- 配色（与站点设计语言一致） ---------------- */
const C = {
  floor: 0x1b1b1e,
  floorLine: 0x2c2c31,
  wall: 0x26262a,
  beam: 0x33333a,
  kraft: 0xc9a277,
  kraftDark: 0xa8763f,
  steel: 0x6e6e75,
  steelLight: 0x9a9aa2,
  ink: 0x2b2b30,
  lamp: 0xfff3dd,
  warn: 0xd9883a,
  paper: 0xe8dfd0,
};

/**
 * 构建工厂场景。纯 three 对象，无 DOM 依赖。
 * @param {object} THREE three 模块命名空间
 * @returns {{scene, stations, path, update, dispose, counts}}
 */
export function buildFactory(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111114);
  scene.fog = new THREE.Fog(0x111114, 20, 52);

  const animators = [];
  const disposables = [];
  const counts = { meshes: 0 };

  /* ---------- 材质小工具 ---------- */
  function mat(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0.05,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      flatShading: !!opts.flatShading,
    });
    disposables.push(m);
    return m;
  }

  function add(mesh) {
    scene.add(mesh);
    counts.meshes += 1;
    return mesh;
  }

  function box(w, h, d, color, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    disposables.push(geo);
    return new THREE.Mesh(geo, mat(color, opts));
  }

  /** 圆柱，轴预旋转为 X 轴，便于绕自身轴自转 */
  function roller(radius, length, color, seg = 20) {
    const geo = new THREE.CylinderGeometry(radius, radius, length, seg);
    geo.rotateZ(Math.PI / 2);
    disposables.push(geo);
    return new THREE.Mesh(geo, mat(color, { metalness: 0.65, roughness: 0.38 }));
  }

  /* ---------- 厂房：地面 / 墙 / 立柱 / 灯带 ---------- */
  const floorGeo = new THREE.PlaneGeometry(46, 38);
  disposables.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, mat(C.floor, { roughness: 0.96 }));
  floor.rotation.x = -Math.PI / 2;
  add(floor);

  const grid = new THREE.GridHelper(46, 23, C.floorLine, C.floorLine);
  grid.position.y = 0.012;
  grid.material.opacity = 0.55;
  grid.material.transparent = true;
  disposables.push(grid.material);
  add(grid);

  // 三面墙（相机在中间走廊，不设前墙，避免回程遮挡）
  const wallH = 6.4;
  const wallMat = mat(C.wall, { roughness: 0.95 });
  const wallSpecs = [
    { w: 46, h: wallH, pos: [0, wallH / 2, -19], rotY: 0 },      // 后
    { w: 38, h: wallH, pos: [-23, wallH / 2, 0], rotY: Math.PI / 2 }, // 左
    { w: 38, h: wallH, pos: [23, wallH / 2, 0], rotY: -Math.PI / 2 }, // 右
  ];
  wallSpecs.forEach((s) => {
    const geo = new THREE.BoxGeometry(s.w, s.h, 0.3);
    disposables.push(geo);
    const wall = new THREE.Mesh(geo, wallMat);
    wall.position.set(...s.pos);
    wall.rotation.y = s.rotY;
    add(wall);
  });

  // 立柱
  [-17, -9, 0, 9, 17].forEach((z) => {
    [-10.5, 10.5].forEach((x) => {
      const pillar = box(0.34, wallH, 0.34, C.beam, { metalness: 0.4, roughness: 0.6 });
      pillar.position.set(x, wallH / 2, z);
      add(pillar);
    });
  });

  // 顶部灯带（自发光，不需要参与光照计算）
  const lampMat = new THREE.MeshBasicMaterial({ color: C.lamp });
  disposables.push(lampMat);
  const lampGeo = new THREE.BoxGeometry(17, 0.12, 0.5);
  disposables.push(lampGeo);
  const lamps = [];
  [-16, -8, 0, 8, 16].forEach((z) => {
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(0, wallH - 0.35, z);
    add(lamp);
    lamps.push(lamp);
  });
  // 灯带极轻微呼吸，避免画面死板
  animators.push((t) => {
    const k = 0.94 + Math.sin(t * 0.8) * 0.06;
    lampMat.color.setRGB(1 * k, 0.953 * k, 0.867 * k);
  });

  /* ---------- 工位 1：纸卷区 ---------- */
  const station1 = new THREE.Group();
  station1.position.set(-7, 0, -12);
  add(station1);

  const reels = [];
  [
    { x: -1.6, z: 0.6, r: 1.15, len: 2.4 },
    { x: 1.5, z: -1.2, r: 1.35, len: 2.6 },
    { x: 0.2, z: 2.2, r: 0.95, len: 2.2 },
  ].forEach((cfg) => {
    const g = new THREE.Group();
    const body = roller(cfg.r, cfg.len, C.kraft, 28);
    g.add(body);
    const core = roller(cfg.r * 0.32, cfg.len + 0.06, C.ink, 16);
    g.add(core);
    g.position.set(cfg.x, cfg.r + 0.02, cfg.z);
    station1.add(g);
    reels.push(body);
  });

  // 瓦楞纸板垛
  for (let i = 0; i < 5; i += 1) {
    const sheet = box(3.2, 0.16, 2.1, i % 2 ? C.kraft : C.kraftDark, { roughness: 0.95 });
    sheet.position.set(3.4, 0.09 + i * 0.17, 1.4);
    sheet.rotation.y = (i % 2 ? 1 : -1) * 0.012;
    station1.add(sheet);
  }

  animators.push((t, dt) => {
    reels.forEach((r, i) => {
      r.rotation.x += dt * (0.22 + i * 0.05);
    });
  });

  /* ---------- 工位 2：印刷机 ---------- */
  const station2 = new THREE.Group();
  station2.position.set(7, 0, -3);
  add(station2);

  // 机身
  const body2 = box(6.2, 3.1, 3.2, C.steel, { metalness: 0.35, roughness: 0.55 });
  body2.position.set(0, 1.55, 0);
  station2.add(body2);

  // 底座
  const base2 = box(6.8, 0.35, 3.6, C.beam, { metalness: 0.3 });
  base2.position.set(0, 0.18, 0);
  station2.add(base2);

  // 印刷辊（4 支，横向排布在机身正面）
  const printRollers = [];
  [-1.9, -0.65, 0.65, 1.9].forEach((x, i) => {
    const r = roller(0.36, 3.5, i % 2 ? C.steelLight : C.ink, 22);
    r.position.set(x, 2.15, 1.72);
    station2.add(r);
    printRollers.push({ mesh: r, dir: i % 2 ? 1 : -1 });
  });

  // 纸带：从下方进入、穿过辊筒、从上方输出
  const web1 = box(6.0, 0.035, 2.4, C.paper, { roughness: 0.8 });
  web1.position.set(0, 1.05, 1.68);
  station2.add(web1);
  const web2 = box(6.0, 0.035, 2.4, C.paper, { roughness: 0.8 });
  web2.position.set(0, 2.72, 1.68);
  station2.add(web2);

  // 警示灯
  const warnMat = new THREE.MeshBasicMaterial({ color: C.warn });
  disposables.push(warnMat);
  const warnGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.34, 12);
  disposables.push(warnGeo);
  const warnLamp = new THREE.Mesh(warnGeo, warnMat);
  warnLamp.position.set(2.6, 3.4, 0);
  station2.add(warnLamp);

  // 电控柜
  const cabinet = box(0.9, 1.9, 0.7, 0x3a3a40, { metalness: 0.4 });
  cabinet.position.set(-3.9, 0.95, 0.8);
  station2.add(cabinet);

  animators.push((t, dt) => {
    printRollers.forEach((r) => {
      r.mesh.rotation.x += dt * r.dir * 1.9;
    });
    // 警示灯呼吸：运行时抢眼，停机时安静
    const k = 0.55 + Math.sin(t * 3.2) * 0.45;
    warnMat.color.setRGB(0.85 * k + 0.1, 0.53 * k + 0.06, 0.23 * k + 0.03);
  });

  /* ---------- 工位 3：模切机 ---------- */
  const station3 = new THREE.Group();
  station3.position.set(-7, 0, 6);
  add(station3);

  const dieBase = box(4.2, 0.9, 3.4, C.beam, { metalness: 0.35, roughness: 0.6 });
  dieBase.position.set(0, 0.45, 0);
  station3.add(dieBase);

  const dieBed = box(3.6, 0.22, 2.8, C.steelLight, { metalness: 0.5, roughness: 0.4 });
  dieBed.position.set(0, 0.98, 0);
  station3.add(dieBed);

  // 上压板（往复运动）
  const dieHead = box(3.4, 0.7, 2.6, C.steel, { metalness: 0.45, roughness: 0.45 });
  dieHead.position.set(0, 2.6, 0);
  station3.add(dieHead);

  // 四根导柱
  [[-1.5, -1.1], [1.5, -1.1], [-1.5, 1.1], [1.5, 1.1]].forEach(([x, z]) => {
    const geo = new THREE.CylinderGeometry(0.09, 0.09, 2.3, 10);
    disposables.push(geo);
    const rod = new THREE.Mesh(geo, mat(C.steelLight, { metalness: 0.7, roughness: 0.3 }));
    rod.position.set(x, 1.9, z);
    station3.add(rod);
  });

  // 待切纸板
  const blank = box(3.0, 0.05, 2.3, C.paper, { roughness: 0.85 });
  blank.position.set(0, 1.13, 0);
  station3.add(blank);

  animators.push((t) => {
    // 往复冲压：sin 取绝对值让下压更"利落"
    const phase = Math.abs(Math.sin(t * 1.35));
    dieHead.position.y = 2.55 - phase * 1.05;
  });

  /* ---------- 工位 4：码垛出库 ---------- */
  const station4 = new THREE.Group();
  station4.position.set(7, 0, 11);
  add(station4);

  // 传送带
  const belt = box(9.4, 0.22, 1.7, 0x3a3a40, { roughness: 0.8 });
  belt.position.set(0, 0.72, 0);
  station4.add(belt);

  // 护栏
  [-0.95, 0.95].forEach((z) => {
    const rail = box(9.4, 0.08, 0.07, C.steelLight, { metalness: 0.6 });
    rail.position.set(0, 0.9, z);
    station4.add(rail);
  });

  // 支腿
  [-4.2, -1.4, 1.4, 4.2].forEach((x) => {
    const leg = box(0.14, 0.72, 0.14, C.beam, { metalness: 0.4 });
    leg.position.set(x, 0.36, 0);
    station4.add(leg);
  });

  // 传送中的纸箱
  const movingBoxes = [];
  for (let i = 0; i < 4; i += 1) {
    const carton = box(0.86, 0.68, 0.86, C.kraft, { roughness: 0.9 });
    carton.position.set(-4.2 + i * 2.4, 1.17, 0);
    station4.add(carton);
    movingBoxes.push(carton);
  }

  // 已成垛的成品
  for (let layer = 0; layer < 3; layer += 1) {
    for (let i = 0; i < 2; i += 1) {
      const stack = box(0.86, 0.68, 0.86, layer % 2 ? C.kraftDark : C.kraft, { roughness: 0.9 });
      stack.position.set(4.6 + i * 0.9, 0.34 + layer * 0.69, 1.9);
      station4.add(stack);
    }
  }

  animators.push((t, dt) => {
    movingBoxes.forEach((b, i) => {
      b.position.x += dt * 0.85;
      if (b.position.x > 4.6) b.position.x = -4.2 - i * 0.2;
    });
  });

  /* ---------- 光照（不用阴影贴图，保证移动端帧率） ---------- */
  const hemi = new THREE.HemisphereLight(0xdce7ff, 0x2a241c, 0.85);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff1d8, 1.25);
  key.position.set(8, 12, 6);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9fb6d8, 0.45);
  fill.position.set(-10, 7, -8);
  scene.add(fill);

  const warm = new THREE.PointLight(0xffd9a0, 0.85, 26);
  warm.position.set(0, 4.6, -6);
  scene.add(warm);

  const warm2 = new THREE.PointLight(0xffd9a0, 0.75, 26);
  warm2.position.set(0, 4.6, 8);
  scene.add(warm2);

  /* ---------- 四个站点与相机路径 ---------- */
  const stations = [
    {
      id: 'paper',
      label: '01 纸卷',
      title: '纸卷区',
      desc: '原纸与瓦楞纸板在这里上机。三层、五层、七层，按承重配纸。',
      camPos: new THREE.Vector3(-2.6, 1.62, -16.2),
      lookAt: new THREE.Vector3(-7.2, 1.5, -12),
    },
    {
      id: 'print',
      label: '02 印刷',
      title: '四色印刷',
      desc: '纸板穿过印刷辊，四色、六色高档印刷机上机。图案不糊边，折线不断色。',
      camPos: new THREE.Vector3(2.2, 1.62, -7.6),
      lookAt: new THREE.Vector3(7.4, 2.1, -3),
    },
    {
      id: 'diecut',
      label: '03 模切',
      title: '模切成型',
      desc: '刀模一次成型，模切、压痕、清废在同一道工序里完成。',
      camPos: new THREE.Vector3(-3.0, 1.62, 2.4),
      lookAt: new THREE.Vector3(-7.0, 2.3, 6.0),
    },
    {
      id: 'stack',
      label: '04 码垛',
      title: '码垛出库',
      desc: '粘箱、打包、码垛。批量大可托盘直发，出园区即上车。',
      camPos: new THREE.Vector3(2.4, 1.62, 15.4),
      lookAt: new THREE.Vector3(7.2, 1.2, 11),
    },
  ];

  // 路径额外插入走廊中点，避免相机贴墙或穿机器
  const pathPoints = [
    stations[0].camPos.clone(),
    new THREE.Vector3(0, 1.62, -11.5),
    stations[1].camPos.clone(),
    new THREE.Vector3(0, 1.62, -2.0),
    stations[2].camPos.clone(),
    new THREE.Vector3(0, 1.62, 8.5),
    stations[3].camPos.clone(),
  ];
  const path = new THREE.CatmullRomCurve3(pathPoints, false, 'catmullrom', 0.4);

  function update(t, dt) {
    for (let i = 0; i < animators.length; i += 1) animators[i](t, dt);
  }

  function dispose() {
    for (let i = 0; i < disposables.length; i += 1) {
      const d = disposables[i];
      if (d && typeof d.dispose === 'function') d.dispose();
    }
    scene.clear();
  }

  return { scene, stations, path, update, dispose, counts };
}

/* ==========================================================================
   浏览器控制器
   ========================================================================== */

const EASE = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * 探测 WebGL 能力，返回明细而不是单一布尔。
 * 注意：每次尝试都用新的 canvas —— 在同一个 canvas 上先取 webgl2 失败后
 * 再取 webgl，部分浏览器会直接返回 null，导致"明明支持却判定不支持"。
 */
export function detectWebGL() {
  const report = {
    globalCtor: false,
    webgl2: false,
    webgl: false,
    experimental: false,
    ok: false,
    reason: '',
  };
  if (typeof document === 'undefined') {
    report.reason = '无 document（非浏览器环境）';
    return report;
  }
  report.globalCtor = typeof window !== 'undefined' && !!window.WebGLRenderingContext;

  const tryCtx = (type) => {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const gl = c.getContext(type, { failIfMajorPerformanceCaveat: false });
      // 立刻释放，避免占用 GPU 上下文名额
      if (gl && gl.getExtension) {
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
      return !!gl;
    } catch (e) {
      report.reason = type + ' 抛错: ' + (e && e.message ? e.message : String(e));
      return false;
    }
  };

  report.webgl2 = tryCtx('webgl2');
  report.webgl = tryCtx('webgl');
  report.experimental = tryCtx('experimental-webgl');
  report.ok = report.webgl2 || report.webgl || report.experimental;
  if (!report.ok && !report.reason) {
    report.reason = report.globalCtor
      ? '三种 context 均返回 null（GPU 被禁用或被列入黑名单）'
      : 'window.WebGLRenderingContext 不存在';
  }
  return report;
}

export function supportsWebGL() {
  try {
    return detectWebGL().ok;
  } catch {
    return false;
  }
}

/**
 * 在指定容器内启动漫游。
 * @param {HTMLElement} root 承载 canvas 与 UI 的容器
 */
export async function createTour(root) {
  const THREE = await import('../vendor/three.module.js');
  const { scene, stations, path, update, dispose } = buildFactory(THREE);

  const canvas = root.querySelector('[data-factory-canvas]');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 120);
  camera.position.copy(stations[0].camPos);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- 相机状态 ---- */
  let stationIndex = 0;
  let fromIndex = 0;
  let toIndex = 0;
  let blend = 1;              // 1 = 已到达
  const moveDuration = reduceMotion ? 0.001 : 1.35;
  let moveElapsed = 0;
  let lookYaw = 0;            // 鼠标拖拽产生的水平偏移
  let lookPitch = 0;
  let dragging = false;
  let lastPointer = { x: 0, y: 0 };
  let hintShown = false;

  const camTmp = new THREE.Vector3();
  const lookTmp = new THREE.Vector3();
  const lookFrom = new THREE.Vector3().copy(stations[0].lookAt);
  const lookTo = new THREE.Vector3().copy(stations[0].lookAt);

  function goTo(index) {
    const target = Math.max(0, Math.min(stations.length - 1, index));
    if (target === stationIndex && blend >= 1) return;
    fromIndex = stationIndex;
    toIndex = target;
    lookFrom.copy(lookTmp.lengthSq() ? lookTmp : stations[fromIndex].lookAt);
    lookTo.copy(stations[target].lookAt);
    moveElapsed = 0;
    blend = 0;
    stationIndex = target;
    syncUI();
  }

  /* ---- UI 同步 ---- */
  const labelEl = root.querySelector('[data-factory-label]');
  const titleEl = root.querySelector('[data-factory-title]');
  const descEl = root.querySelector('[data-factory-desc]');
  const dots = Array.prototype.slice.call(root.querySelectorAll('[data-factory-dot]'));
  const prevBtn = root.querySelector('[data-factory-prev]');
  const nextBtn = root.querySelector('[data-factory-next]');

  function syncUI() {
    const s = stations[stationIndex];
    if (labelEl) labelEl.textContent = s.label;
    if (titleEl) titleEl.textContent = s.title;
    if (descEl) descEl.textContent = s.desc;
    dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === stationIndex);
      d.setAttribute('aria-current', i === stationIndex ? 'step' : 'false');
    });
    if (prevBtn) prevBtn.disabled = stationIndex === 0;
    if (nextBtn) nextBtn.disabled = stationIndex === stations.length - 1;
  }

  dots.forEach((d, i) => d.addEventListener('click', () => goTo(i)));
  if (prevBtn) prevBtn.addEventListener('click', () => goTo(stationIndex - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => goTo(stationIndex + 1));

  /* ---- 鼠标 / 触摸拖拽转头 ---- */
  function onPointerDown(e) {
    dragging = true;
    lastPointer = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
    if (!hintShown) {
      hintShown = true;
      root.classList.add('is-interacted');
    }
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer = { x: e.clientX, y: e.clientY };
    lookYaw = Math.max(-0.62, Math.min(0.62, lookYaw - dx * 0.0032));
    lookPitch = Math.max(-0.28, Math.min(0.28, lookPitch - dy * 0.0022));
  }
  function onPointerUp() {
    dragging = false;
    canvas.style.cursor = 'grab';
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);

  /* ---- 键盘（左右方向键切换站点） ---- */
  function onKey(e) {
    if (e.key === 'ArrowRight') { goTo(stationIndex + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { goTo(stationIndex - 1); e.preventDefault(); }
  }
  root.addEventListener('keydown', onKey);

  /* ---- 尺寸：带兜底，避免首次测量为 0 导致 drawingBuffer 永远 0 ---- */
  const diag = { w: 0, h: 0, dpr: 1, calls: 0, frames: 0, err: '' };

  function resize() {
    const rect = root.getBoundingClientRect();
    let w = Math.round(rect.width);
    let h = Math.round(rect.height);
    if (!w || !h) {
      // 元素可能还没完成布局：用父级宽度按 16:9 推一个
      const pw = root.parentElement ? Math.round(root.parentElement.getBoundingClientRect().width) : 0;
      w = pw || 960;
      h = Math.round((w * 9) / 16);
    }
    if (w < 2 || h < 2) { w = 960; h = 540; }
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    diag.w = w;
    diag.h = h;
    diag.dpr = renderer.getPixelRatio();
    paintDiag();
  }

  function paintDiag() {
    const el = root.querySelector('[data-factory-diag]');
    if (!el) return;
    el.textContent = diag.err
      ? 'ERR ' + diag.err.slice(0, 90)
      : `${diag.w}×${diag.h} @${diag.dpr}x · draws ${diag.calls} · frames ${diag.frames}`;
    el.classList.toggle('is-error', !!diag.err);
  }

  function fail(reason) {
    diag.err = String(reason && reason.message ? reason.message : reason);
    paintDiag();
    console.error('[factory-tour]', reason);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  /* ---- 渲染循环：离屏即停 ---- */
  let running = true;
  let visible = true;
  let rafId = 0;
  let clockLast = performance.now();
  let elapsed = 0;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!running || !visible) { clockLast = now; return; }
    try {
      const dt = Math.min((now - clockLast) / 1000, 0.05);
      clockLast = now;
      elapsed += dt;

      update(elapsed, dt);

      // 相机推进
      if (blend < 1) {
        moveElapsed += dt;
        blend = Math.min(1, moveElapsed / moveDuration);
      }
      const e = EASE(blend);
      const segCount = stations.length - 1;
      const pathT = segCount > 0
        ? Math.min(1, (fromIndex + (toIndex - fromIndex) * e) / segCount)
        : 0;
      path.getPointAt(pathT, camTmp);
      if (e >= 0.999) camTmp.copy(stations[stationIndex].camPos);
      camera.position.copy(camTmp);

      // 视点插值 + 手持微抖
      lookTmp.copy(lookFrom).lerp(lookTo, e);
      const shake = reduceMotion ? 0 : 0.012;
      lookTmp.x += Math.sin(elapsed * 0.9) * shake;
      lookTmp.y += Math.cos(elapsed * 0.7) * shake * 0.6;

      // 拖拽偏移叠加到朝向
      const dir = lookTmp.clone().sub(camera.position).normalize();
      const yawAngle = Math.atan2(dir.x, dir.z) + lookYaw;
      const pitchAngle = Math.asin(Math.max(-1, Math.min(1, dir.y))) + lookPitch;
      const target = new THREE.Vector3(
        camera.position.x + Math.sin(yawAngle) * Math.cos(pitchAngle) * 10,
        camera.position.y + Math.sin(pitchAngle) * 10,
        camera.position.z + Math.cos(yawAngle) * Math.cos(pitchAngle) * 10,
      );
      camera.lookAt(target);

      renderer.render(scene, camera);
      diag.calls = renderer.info.render.calls;
      diag.frames += 1;
      if (diag.frames % 30 === 0) paintDiag();
    } catch (err) {
      // 单帧异常不能让画面停在黑屏上而无提示
      running = false;
      cancelAnimationFrame(rafId);
      fail(err);
    }
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { visible = en.isIntersecting; });
  }, { threshold: 0.05 });
  io.observe(root);

  syncUI();
  resize();
  rafId = requestAnimationFrame(frame);

  /* ---- 清理 ---- */
  function destroy() {
    running = false;
    cancelAnimationFrame(rafId);
    io.disconnect();
    ro.disconnect();
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('keydown', onKey);
    dispose();
    renderer.dispose();
  }

  return { goTo, destroy, stations };
}
