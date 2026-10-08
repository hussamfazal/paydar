// Paydar landing page: the 3D hero. "See every charge coming."
// A near-black phone showing the real app screen, floating over a radar floor drawn in the app's guilloche rosette.
// A sweep turns around the floor; each charge tag pings as it passes. Plain ES module, no build step.
import * as THREE from './vendor/three.module.min.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
const fract = (x) => x - Math.floor(x);
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

// Timeline
const T_INTRO = 1.8;            // seconds until the banner lands and the continuous sweep takes over
const SWEEP_PERIOD = 6;         // seconds per turn after the intro
const OMEGA = TAU / SWEEP_PERIOD;
const BLIP_ANGLE = 30 * DEG;    // 1 o'clock, clockwise from "up" in the disc's own frame
const BLIP_R = 0.64;            // on the middle brand ring
const PING_LIFE = 1.4;          // blip ping ring, seconds

// Phone geometry, in phone heights (the phone is 1 unit tall). It follows the App Store mockup frame
// (tools/frame_screenshots.py): a near-black green body, a thin lighter rim, an even slim bezel.
const SHEET = { w: 1320, h: 2868 };
const SHEET_K = SHEET.w / SHEET.h;
const BEZEL_FRAC = 0.0185;      // bezel = 1.85% of the phone's width, the same on every side
const BODY_W = SHEET_K / (1 - 2 * BEZEL_FRAC * (1 - SHEET_K));
const BEZEL = BEZEL_FRAC * BODY_W;
const SCREEN_H = 1 - 2 * BEZEL;
const SCREEN_W = SHEET_K * SCREEN_H;
const SCREEN_R = 0.0985 * SCREEN_W;   // screen corner radius: 9.85% of the screen width
const BODY_R = SCREEN_R + BEZEL;      // concentric with the screen
const BEVEL = 0.003;
const RIM_W = 0.0032;           // the thin lighter rim along the edge of the front face
const THICK = 0.08;

// Pose
const BASE_RY = -14 * DEG;
const BASE_RX = 4 * DEG;
const DISC_R = 1.3;             // radar radius in phone heights (wide layouts)
const DISC_TILT = -70 * DEG;
const DISC_HALF = 1.15;         // the plane reaches 1.15 R so the radial fade has room

// The eight charge tags. Prices are checked against docs/prices/prices.json: do not change them.
// logo = the file in assets/logos/ (iCloud+ has none: Apple services use a neutral tile, drawn below).
// d = wide layout, n = narrow layout; [x, y, zFar, zNear] in phone heights from the phone's centre.
const TAGS = [
  { name: 'Netflix', logo: 'netflix',         price: '$19.99',            tint: '#F0A58E', phase: 0.000, d: [ 0.50,  0.36, -1.1,  0.25], n: [ 0.30,  0.60, -0.5,  0.20] },
  { name: 'Spotify', logo: 'spotify',         price: '$12.99',            tint: '#9CE3C2', phase: 0.500, d: [ 0.32,  0.64, -1.2,  0.15], n: [-0.28,  0.60, -0.4,  0.30] },
  { name: 'iCloud+', logo: null,         price: '$2.99',             tint: '#88D3DB', phase: 0.250, d: [ 0.48, -0.38, -1.3,  0.05], n: [ 0.30,  0.44, -0.2,  0.55] },
  { name: 'Disney+', logo: 'disneyplus',         price: 'trial, 3 days left', tint: '#F5C578', phase: 0.750, d: [-0.62, -0.36, -0.8,  0.50], n: [ 0.00,  0.76, -0.6,  0.00] },
  { name: 'YouTube Premium', logo: 'youtube', price: '$15.99',            tint: '#DCA4C6', phase: 0.125, d: [-0.60,  0.42, -1.4, -0.20], n: null },
  { name: 'ChatGPT', logo: 'chatgpt',         price: '$20.00',            tint: '#95BFE9', phase: 0.625, d: [ 0.54,  0.04, -1.5, -0.30], n: [-0.30,  0.40, -0.2,  0.55] },
  { name: 'Xbox Game Pass', logo: 'xbox',  price: '$14.99',            tint: '#B2ACE8', phase: 0.375, d: [-0.84,  0.06, -1.5, -0.30], n: null },
  { name: 'Amazon Prime', logo: 'amazon',    price: '$14.99',            tint: '#C4DB9E', phase: 0.875, d: [-0.20, -0.62, -1.0,  0.35], n: null },
];
const PHONE_HALF_W = 0.27;      // generous half width of the tilted phone's silhouette, in phone heights
const TAG_DRIFT = 14;           // seconds for a tag to drift from far to near

const params = new URLSearchParams(location.search);
const FORCE_REDUCE = params.get('reduce') === '1';           // testing only
const FREEZE_AT = params.has('freeze') ? parseFloat(params.get('freeze')) : null; // testing only: render once at t seconds

// ---------------------------------------------------------------------------------------------------------------------
// Radar floor shader
// ---------------------------------------------------------------------------------------------------------------------
const DISC_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DISC_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uSweep;   // radians, clockwise from "up"
uniform float uGrow;    // 0..1 intro growth
uniform float uPing;    // seconds since the sweep last passed the blip; negative = none
uniform float uBlip;    // blip brightness
uniform float uBlipShow; // 0..1: the blip appears when the first sweep reaches it
uniform float uHalf;    // plane half size in R units
uniform float uBlipAngle;
uniform float uBlipR;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const vec3 COTTON = vec3(0.945, 0.953, 0.933);
const vec3 MINT   = vec3(0.749, 0.890, 0.800);
const vec3 AMBER  = vec3(0.949, 0.710, 0.267);

void main() {
  // plane coordinates in units of R, scaled so the whole pattern grows out of the centre during the intro
  vec2 p = (vUv - 0.5) * 2.0 * uHalf / (0.6 + 0.4 * uGrow);
  float rho = length(p);
  float theta = atan(p.x, p.y);              // 0 = up, clockwise positive
  float fwr = max(fwidth(rho), 1e-6);

  float edgeFade = 1.0 - smoothstep(0.9, 1.13, rho);
  float nearFade = 1.0 - 0.92 * smoothstep(0.12, 0.95, -p.y);   // the half nearest the camera dissolves, so nothing crowds the bottom edge
  float rosFade = 1.0 - smoothstep(0.5, 1.05, rho);
  float growMask = 1.0 - smoothstep(uGrow * 1.14 - 0.16, uGrow * 1.14, rho);
  float fade = edgeFade * growMask * nearFade;

  // the sweep first, so it can light up the rings as it passes
  float delta = mod(uSweep - theta, TAU);    // 0 at the leading edge, growing behind it
  float wedgeW = 70.0 * PI / 180.0;
  float shape = delta < wedgeW ? pow(1.0 - delta / wedgeW, 1.7) : 0.0;
  float lead = 1.0 - smoothstep(0.0, 0.012, delta);
  float sweepMask = smoothstep(0.02, 0.08, rho) * (1.0 - smoothstep(0.93, 1.08, rho)) * growMask * mix(1.0, nearFade, 0.9);
  float wedgeA = (0.27 * shape + 0.07 * lead) * sweepMask;

  // guilloche rosette: 20 rings, r = base + amp * sin(32 theta + i pi)
  const float inner = 0.12;
  float gap = (1.0 - inner) / 20.0;
  float amp = 1.6 * gap;
  float sn = sin(32.0 * theta);
  float fwP = max(fwidth(rho - amp * sn), 1e-6);
  float fwM = max(fwidth(rho + amp * sn), 1e-6);
  float i0 = floor((rho - inner) / gap) - 1.0;
  float ros = 0.0;
  for (int j = -2; j <= 2; j++) {
    float i = i0 + float(j);
    float valid = step(0.0, i) * step(i, 19.0);
    float even = step(mod(i, 2.0), 0.5);
    float sg = even * 2.0 - 1.0;
    float s = rho - (inner + gap * (i + 1.0) + amp * sn * sg);
    float fw = mix(fwM, fwP, even);
    float px = abs(s) / fw;
    ros = max(ros, valid * (1.0 - smoothstep(0.30, 1.15, px)));
  }
  float density = smoothstep(1.2, 4.5, gap / fwr);   // fade the rosette where the lines would crowd (moire)
  float rosA = ros * density * 0.10 * (1.0 + 2.0 * shape) * fade * (0.35 + 0.65 * rosFade);

  // three brand rings at 0.32, 0.64, 1.0 of R
  float ringA = 0.0;
  float hw = max(0.0042 / fwr, 0.85);
  for (int k = 0; k < 3; k++) {
    float rk = 0.32 * float(k + 1);
    if (k == 2) rk = 1.0;
    float px = abs(rho - rk) / fwr;
    ringA = max(ringA, 1.0 - smoothstep(hw - 0.5, hw + 0.7, px));
  }
  ringA *= 0.34 * (1.0 + 1.1 * shape) * fade;

  // soft mint pool under the phone
  float pool = 0.10 * exp(-pow(rho / 0.55, 2.0)) * growMask;

  // the amber blip at 1 o'clock on the middle ring, with a ping ring when the sweep passes
  vec2 bp = uBlipR * vec2(sin(uBlipAngle), cos(uBlipAngle));
  float d = length(p - bp);
  float fwd = max(fwidth(d), 1e-6);
  float blipOn = uBlipShow * smoothstep(0.45, 0.85, uGrow);
  float core = 1.0 - smoothstep(0.020, 0.030, d);
  float glow = exp(-pow(d / 0.075, 2.0)) * 0.42;
  float halo = (1.0 - smoothstep(0.7, 1.7, abs(d - 0.052) / fwd)) * 0.38;
  float pt = clamp(uPing / ${PING_LIFE.toFixed(2)}, 0.0, 1.0);
  float pingOn = step(0.0, uPing) * (1.0 - pt);
  float rr = 0.04 + 0.26 * (1.0 - pow(1.0 - pt, 2.2));
  float pingA = pingOn * 0.8 * (1.0 - smoothstep(0.8, 2.0, abs(d - rr) / fwd));
  float blipA = (core + glow + halo) * uBlip * blipOn + pingA * blipOn;
  blipA *= edgeFade;

  vec3 col = COTTON * rosA + MINT * (ringA + wedgeA + pool) + AMBER * blipA;
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  gl_FragColor = vec4(col, a);               // premultiplied light, drawn additively
}`;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------
function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function pillPath(ctx, x, y, w, h) {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
}

const FONT = '-apple-system, "SF Pro Text", system-ui, sans-serif';

// A dark glass pill drawn at 2x, plus a matching amber outline used for the ping.
// The service logo is drawn in a rounded square left of the name; redraw(img) repaints once the logo has loaded.
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// iCloud+: a neutral tile with a simple white cloud (three circles on a flat base). Not an Apple glyph.
function drawCloudTile(ctx, x, y, s) {
  roundRectPath(ctx, x, y, s, s, 0.22 * s);
  ctx.fillStyle = '#4F7396';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  const circle = (cx, cy, r) => { ctx.beginPath(); ctx.arc(x + cx * s, y + cy * s, r * s, 0, TAU); ctx.fill(); };
  circle(0.335, 0.555, 0.135);
  circle(0.50, 0.44, 0.185);
  circle(0.675, 0.545, 0.145);
  ctx.fillRect(x + 0.335 * s, y + 0.5 * s, 0.34 * s, 0.19 * s);
}

function makeTagTextures(cfg, maxAniso) {
  const { name, price, tint } = cfg;
  const S = 2, M = 18 * S / 2 + 6;          // transparent margin, so the glow of the outline is not clipped
  const pillH = 56 * S;
  const m = document.createElement('canvas').getContext('2d');
  m.font = `600 ${22 * S}px ${FONT}`;
  const wName = m.measureText(name).width;
  m.font = `500 ${22 * S}px ${FONT}`;
  const wPrice = m.measureText(price).width;
  const capH = 0.71 * 22 * S;               // cap height of the text
  const logo = Math.round(1.6 * capH);      // the logo tile: about 1.6x the cap height
  const padL = 15 * S, g1 = 11 * S, g2 = 8 * S, padR = 22 * S;
  const pillW = Math.ceil(padL + logo + g1 + wName + g2 + wPrice + padR);
  const W = pillW + 2 * M, H = pillH + 2 * M;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const draw = (img, failed) => {
    ctx.clearRect(0, 0, W, H);
    pillPath(ctx, M, M, pillW, pillH);
    ctx.fillStyle = 'rgba(15,26,21,0.82)';
    ctx.fill();
    pillPath(ctx, M + S / 2, M + S / 2, pillW - S, pillH - S);   // thin border, with the tint as a quiet accent
    ctx.strokeStyle = 'rgba(191,227,204,0.25)';
    ctx.lineWidth = S;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(M + pillW * 0.5, M, pillW * 0.5, pillH);            // the tint accent: a hairline on the right half of the rim
    ctx.clip();
    pillPath(ctx, M + S / 2, M + S / 2, pillW - S, pillH - S);
    ctx.strokeStyle = tint;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = S;
    ctx.stroke();
    ctx.restore();
    const cy = M + pillH / 2;
    const lx = M + padL, ly = cy - logo / 2;
    if (!cfg.logo) {
      drawCloudTile(ctx, lx, ly, logo);
    } else if (img) {
      ctx.save();
      roundRectPath(ctx, lx, ly, logo, logo, 0.22 * logo);
      ctx.clip();
      ctx.drawImage(img, lx, ly, logo, logo);
      ctx.restore();
    } else {
      roundRectPath(ctx, lx, ly, logo, logo, 0.22 * logo);
      ctx.fillStyle = failed ? tint : 'rgba(241,243,238,0.10)';
      ctx.fill();
    }
    roundRectPath(ctx, lx + 0.5 * S, ly + 0.5 * S, logo - S, logo - S, 0.22 * logo);   // a hairline keeps dark logos readable on the dark pill
    ctx.strokeStyle = 'rgba(241,243,238,0.16)';
    ctx.lineWidth = S;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#F1F3EE';
    ctx.font = `600 ${22 * S}px ${FONT}`;
    const tx = lx + logo + g1;
    ctx.fillText(name, tx, cy + S * 0.5);
    ctx.font = `500 ${22 * S}px ${FONT}`;
    ctx.fillStyle = 'rgba(241,243,238,0.86)';
    ctx.fillText(price, tx + wName + g2, cy + S * 0.5);
  };
  draw(null, false);

  const o = document.createElement('canvas');
  o.width = W; o.height = H;
  const octx = o.getContext('2d');
  octx.shadowColor = 'rgba(242,181,68,0.95)';
  octx.shadowBlur = 10 * S;
  octx.strokeStyle = '#F2B544';
  octx.lineWidth = 2.5 * S;
  pillPath(octx, M, M, pillW, pillH);
  octx.stroke();
  octx.shadowBlur = 4 * S;
  octx.stroke();

  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };
  const map = mk(c);
  return {
    map, outline: mk(o), aspect: W / H, pillAspect: pillW / pillH, fullW: W, fullH: H, pillH, M,
    redraw(img, failed) { draw(img, failed); map.needsUpdate = true; },
  };
}

// A tiny procedural studio for the phone's metal edges to reflect (baked once; no addons, no assets).
function buildEnvironment(renderer) {
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(new THREE.SphereGeometry(30, 24, 12), new THREE.MeshBasicMaterial({ color: 0x0a130f, side: THREE.BackSide })));
    const panel = (w, h, hex, k, pos) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]);
      m.lookAt(0, 0, 0);
      sc.add(m);
    };
    panel(10, 12, 0xffe3c2, 6.0, [-12, 9, 8]);     // warm softbox, top left
    panel(3, 16, 0xbfe3cc, 6.0, [13, 2, -9]);      // mint strip behind, right
    panel(16, 2.5, 0xf1f3ee, 2.6, [0, 12, -5]);    // thin top strip
    panel(12, 3, 0x2d6a52, 1.8, [0, -11, 6]);      // green bounce from below
    panel(2.5, 12, 0xf1f3ee, 1.4, [-14, 0, -4]);   // cool edge, left
    const rt = pm.fromScene(sc, 0.03);
    pm.dispose();
    return rt.texture;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------------------------------
function boot(host) {
  const hero = host.closest('[data-hero]') || host.parentElement || host;
  const anchor = hero.querySelector('[data-hero-anchor]');
  const banner = hero.querySelector('[data-hero-banner]');
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reduceMQ.matches || FORCE_REDUCE;

  // renderer (feature-detects WebGL: the constructor throws without it)
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    return;
  }
  if (!renderer.getContext()) return;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;opacity:0;transition:opacity 600ms ease';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const FOV = 28, CAM_D = 10;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 60);
  camera.position.set(0, 0, CAM_D);
  camera.lookAt(0, 0, 0);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // stage: placed and scaled so the phone fits the anchor; everything lives in phone heights inside it
  const stage = new THREE.Group();
  scene.add(stage);
  const rig = new THREE.Group();      // the phone, which bobs, tilts and lifts
  stage.add(rig);

  // lights
  scene.add(new THREE.HemisphereLight(0xbfe3cc, 0x0a130f, 0.55));
  const key = new THREE.DirectionalLight(0xffdcb8, 2.6);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe3cc, 3.4);
  rim.position.set(5, 1.5, -4);
  scene.add(rim);
  const env = buildEnvironment(renderer);

  // phone body: near-black green, with a thin lighter rim along the edge of the front face (like the App Store mockup frame)
  const bodyShape = roundedRectShape(BODY_W - 2 * BEVEL, 1 - 2 * BEVEL, BODY_R - BEVEL);
  const depth = THICK - 2 * BEVEL;
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 3, curveSegments: 40, steps: 1,
  });
  bodyGeo.translate(0, 0, -depth / 2);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0e1612, metalness: 0.5, roughness: 0.45, envMap: env, envMapIntensity: 1.1 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  rig.add(body);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x3e5449, emissive: 0x3e5449, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.4, envMap: env, envMapIntensity: 1.2,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const rimShape = roundedRectShape(BODY_W - 2 * BEVEL, 1 - 2 * BEVEL, BODY_R - BEVEL);
  rimShape.holes.push(roundedRectShape(BODY_W - 2 * BEVEL - 2 * RIM_W, 1 - 2 * BEVEL - 2 * RIM_W, BODY_R - BEVEL - RIM_W));
  const rimFront = new THREE.Mesh(new THREE.ShapeGeometry(rimShape, 40), rimMat);
  rimFront.position.z = THICK / 2 + 0.0002;
  rig.add(rimFront);

  // side buttons
  const btnMat = rimMat;
  const addButton = (side, y, h) => {
    const g = new THREE.BoxGeometry(0.007, h, 0.017);
    const m = new THREE.Mesh(g, btnMat);
    m.position.set(side * (BODY_W / 2 + 0.0008), y, 0);
    rig.add(m);
  };
  addButton(1, 0.16, 0.10);       // side button
  addButton(-1, 0.265, 0.035);    // action button
  addButton(-1, 0.185, 0.07);     // volume up
  addButton(-1, 0.095, 0.07);     // volume down

  // screen: rounded rect with UVs normalised across its bounding box
  const screenGeo = new THREE.ShapeGeometry(roundedRectShape(SCREEN_W, SCREEN_H, SCREEN_R), 24);
  {
    const pos = screenGeo.attributes.position, uv = screenGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / SCREEN_W + 0.5, pos.getY(i) / SCREEN_H + 0.5);
    uv.needsUpdate = true;
  }
  const screenMat = new THREE.MeshBasicMaterial({ toneMapped: false, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  const frontZ = THICK / 2;
  screen.position.z = frontZ + 0.0006;
  rig.add(screen);

  // a faint diagonal sheen across the glass that slides with the pointer
  const sheenCanvas = document.createElement('canvas');
  sheenCanvas.width = 256; sheenCanvas.height = 256;
  {
    const c = sheenCanvas.getContext('2d');
    const g = c.createLinearGradient(40, 0, 216, 256);
    g.addColorStop(0.0, 'rgba(255,255,255,0)');
    g.addColorStop(0.42, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.20)');
    g.addColorStop(0.58, 'rgba(255,255,255,0)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  }
  const sheenTex = new THREE.CanvasTexture(sheenCanvas);
  sheenTex.colorSpace = THREE.SRGBColorSpace;
  const sheen = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({
    map: sheenTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0.55,
  }));
  sheen.position.z = frontZ + 0.0012;
  sheen.renderOrder = 3;
  rig.add(sheen);

  // radar floor
  const discMat = new THREE.ShaderMaterial({
    vertexShader: DISC_VERT,
    fragmentShader: DISC_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
    uniforms: {
      uSweep: { value: BLIP_ANGLE },
      uGrow: { value: 1 },
      uPing: { value: -1 },
      uBlip: { value: 1 },
      uBlipShow: { value: 1 },
      uHalf: { value: DISC_HALF },
      uBlipAngle: { value: BLIP_ANGLE },
      uBlipR: { value: BLIP_R },
    },
  });
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), discMat);
  disc.rotation.x = DISC_TILT;
  disc.renderOrder = -1;
  stage.add(disc);

  // charge tags
  const tags = TAGS.map((cfg) => {
    const tex = makeTagTextures(cfg, maxAniso);
    const mat = new THREE.MeshBasicMaterial({ map: tex.map, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const omat = new THREE.MeshBasicMaterial({ map: tex.outline, transparent: true, depthWrite: false, toneMapped: false, opacity: 0, blending: THREE.AdditiveBlending });
    const outline = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), omat);
    outline.position.z = 0.001;
    outline.renderOrder = 2;                         // always drawn after its pill, never swapping order frame to frame
    mesh.add(outline);
    mesh.renderOrder = 1;
    mesh.visible = false;
    stage.add(mesh);
    return { cfg, tex, mesh, mat, omat, pingT: 99, prevDelta: null, alphaIntro: 0 };
  });

  const fitA = new THREE.Vector3(), fitB = new THREE.Vector3();
  // logos: repaint each pill once its image has loaded (the pills are readable meanwhile)
  const loadLogo = (id) => new Promise((res) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => res(false);
    im.src = new URL('./logos/' + id + '.webp', import.meta.url).href;
  });
  Promise.all(tags.map((tg) => (tg.cfg.logo ? loadLogo(tg.cfg.logo) : Promise.resolve(null)))).then((imgs) => {
    if (dead) return;
    imgs.forEach((im, i) => { if (tags[i].cfg.logo) tags[i].tex.redraw(im || null, im === false); });
    if (firstFrame) { if (staticMode()) renderOnce(); else if (!running) draw(); }
  });

  // layout state
  const L = { avoid: [], ceil: 0, w: 1, h: 1, S: 4, narrow: false, phonePx: 600, visHs: 1.2, discR: DISC_R, tagH: 0.062 };

  function layout() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    const hr = host.getBoundingClientRect();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visH = 2 * CAM_D * Math.tan((FOV / 2) * DEG);
    const visW = visH * camera.aspect;
    let cx = w / 2, cy = h * 0.5, ah = h * 0.8;
    if (anchor) {
      const ar = anchor.getBoundingClientRect();
      if (ar.height > 1) { cx = ar.left + ar.width / 2 - hr.left; cy = ar.top + ar.height / 2 - hr.top; ah = ar.height; }
    }
    let S = (ah / h) * visH;                         // world height of the phone, first guess
    stage.scale.setScalar(S);
    stage.position.set((cx / w - 0.5) * visW, (0.5 - cy / h) * visH, 0);
    // fit exactly: measure the phone's centre line (front face, resting pose) through the camera and correct, so the
    // perspective of the tilt and the thickness do not leave it a few percent off the anchor
    rig.rotation.set(BASE_RX, BASE_RY, 0);
    rig.position.set(0, 0, 0);
    camera.updateMatrixWorld();
    for (let it = 0; it < 3; it++) {
      stage.updateMatrixWorld(true);
      const top = rig.localToWorld(fitA.set(0, 0.5, THICK / 2)).project(camera);
      const bot = rig.localToWorld(fitB.set(0, -0.5, THICK / 2)).project(camera);
      const hpx = (top.y - bot.y) * 0.5 * h;
      const cpx = ((top.x + bot.x) * 0.25 + 0.5) * w;
      const cpy = (0.5 - (top.y + bot.y) * 0.25) * h;
      if (!(hpx > 1)) break;
      S *= ah / hpx;
      stage.scale.setScalar(S);
      stage.position.x += (cx - cpx) / w * visW;
      stage.position.y -= (cy - cpy) / h * visH;
    }
    // the hero copy (marked data-hero-avoid on the page): tags never sit over the text
    L.avoid = [].map.call(document.querySelectorAll('[data-hero-avoid]'), (el) => {
      const r = el.getBoundingClientRect();
      return { l: (r.left - hr.left) / w, r: (r.right - hr.left) / w, t: (r.top - hr.top) / h, b: (r.bottom - hr.top) / h, copy: el.hasAttribute('data-hero-copy') };
    });
    // a fixed bar over the hero (marked data-hero-ceiling): tags stay below it
    const ceil = document.querySelector('[data-hero-ceiling]');
    L.ceil = ceil ? Math.max(0, (ceil.getBoundingClientRect().bottom - hr.top) / h) : 0;
    L.w = w; L.h = h; L.phonePx = ah; L.S = S;
    L.visHs = visH / S;
    L.narrow = w / h < 0.85;
    L.discR = L.narrow ? 1.25 : DISC_R;
    L.tagH = Math.max(0.066, 32 / ah);
    // disc: centred under the phone, pushed back
    const dy = L.narrow ? -0.27 : -0.48, dz = L.narrow ? -0.5 : -0.25;
    disc.position.set(L.narrow ? 0 : 0.16, dy, dz);
    disc.scale.setScalar(L.discR * DISC_HALF);
    discMat.uniforms.uHalf.value = DISC_HALF;
    scrollUpdate();
  }

  // pointer, scroll
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', (e) => {
    ptr.x = clamp(e.clientX / window.innerWidth * 2 - 1, -1, 1);
    ptr.y = clamp(e.clientY / window.innerHeight * 2 - 1, -1, 1);
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { ptr.x = 0; ptr.y = 0; });
  let scrollTarget = 0, scrollSmooth = 0;
  function scrollUpdate() {
    const r = hero.getBoundingClientRect();
    scrollTarget = clamp(-r.top / Math.max(1, r.height));
  }
  window.addEventListener('scroll', () => { scrollUpdate(); if (FREEZE_AT !== null && !reduced()) renderCurrent(); }, { passive: true });

  // -----------------------------------------------------------------------------------------------------------------
  // Timeline
  // -----------------------------------------------------------------------------------------------------------------
  function sweepAt(t) {
    if (t >= T_INTRO) return BLIP_ANGLE + (t - T_INTRO) * OMEGA;
    const t0 = 0.15, dur = T_INTRO - t0;
    const p = clamp((t - t0) / dur);
    const m1 = OMEGA * dur / TAU;                     // end slope, so the intro turn flows into the slow sweep
    const hh = (3 * p * p - 2 * p * p * p) + m1 * (p * p * p - p * p);
    return BLIP_ANGLE - TAU * (1 - hh);
  }

  let bannerIn = false;
  function markBanner() {
    if (bannerIn) return;
    bannerIn = true;
    if (banner) banner.classList.add('is-in');
  }

  function update(t, dt, still) {
    const intro = still ? 1 : clamp(t / T_INTRO);
    const grow = still ? 1 : easeOutCubic((t - 0.1) / 0.9);
    const sweep = still ? BLIP_ANGLE : sweepAt(t);
    const tagT = still ? 3.4 : t;

    // pointer and scroll, damped
    const k = 1 - Math.exp(-dt * 5);
    ptr.sx += (ptr.x - ptr.sx) * k;
    ptr.sy += (ptr.y - ptr.sy) * k;
    scrollSmooth = FREEZE_AT !== null ? scrollTarget : scrollSmooth + (scrollTarget - scrollSmooth) * (1 - Math.exp(-dt * 8));
    const sc = still ? 0 : smooth(0, 1, scrollSmooth);

    // phone
    const rise = still ? 0 : 0.06 * (1 - easeOutCubic(t / 1.4));
    const bob = still ? 0 : Math.sin(t * TAU / 6) * 0.015;
    rig.position.y = bob - rise + sc * 0.08 * L.visHs;
    rig.rotation.set(BASE_RX + ptr.sy * 7 * DEG * (still ? 0 : 1), BASE_RY + ptr.sx * 7 * DEG * (still ? 0 : 1) + sc * 20 * DEG, 0);
    sheenTex.offset.x = ptr.sx * -0.18 + (still ? 0 : Math.sin(t * 0.5) * 0.06);

    // radar
    const u = discMat.uniforms;
    u.uGrow.value = grow;
    u.uSweep.value = sweep;
    let pingSince = -1;
    if (still) pingSince = -1;
    else if (t >= T_INTRO) pingSince = (t - T_INTRO) % SWEEP_PERIOD;
    u.uPing.value = pingSince;
    u.uBlipShow.value = still ? 1 : easeOutCubic((t - 1.45) / 0.45);
    u.uBlip.value = pingSince >= 0 ? 0.85 + 0.55 * Math.exp(-pingSince * 2.2) : 0.9;

    // tags
    const dl = disc.position, ca = Math.cos(DISC_TILT), sa = Math.sin(DISC_TILT);
    const sweepDisc = sweep;
    const distS = CAM_D / L.S;                         // camera distance in phone heights
    const stageXs = stage.position.x / L.S, stageYs = stage.position.y / L.S;
    const halfW = L.visHs * camera.aspect / 2;         // visible half width / height at the phone's depth, in phone heights
    const halfH = L.visHs / 2;
    for (let i = 0; i < tags.length; i++) {
      const tg = tags[i], c = tg.cfg;
      const cfg = (L.narrow && c.n) ? c.n : c.d;
      // a settled frame (reduced motion) spreads the tags along their paths and shows them all
      const life = still ? 0.2 + 0.6 * fract(i * 0.382 + 0.1) : fract(tagT / TAG_DRIFT + c.phase);

      let a = still ? 1 : smooth(0, 0.12, life) * (1 - smooth(0.88, 1, life));
      if (!still) a *= smooth(0.55 + 0.07 * i, 1.15 + 0.07 * i, t);

      // depth first: the pill drifts toward the camera
      const z = cfg[2] + (cfg[3] - cfg[2]) * life;
      const f = distS / (distS - z);                   // perspective magnification at this depth
      // size, with the ping pulse; far pills are enlarged a little so their text stays readable
      const pk = tg.pingT < 0.9 ? 1 - tg.pingT / 0.9 : 0;
      const pulse = pk * pk;
      const comp = Math.pow(1 / f, 0.45);
      const sy = L.tagH * comp * (tg.tex.fullH / tg.tex.pillH) * (1 + 0.08 * pulse);
      const sx = L.tagH * comp * tg.tex.pillAspect * (tg.tex.fullW / (tg.tex.fullW - 2 * tg.tex.M)) * (1 + 0.08 * pulse);

      // position: place the pill in view space so it never hides half behind the phone,
      // never covers the middle of the screen, and never leaves the viewport, whatever the anchor is
      let x = cfg[0] + 0.012 * Math.sin(tagT * 0.6 + c.phase * 7);
      let y = cfg[1] + 0.016 * Math.sin(tagT * 0.8 + c.phase * 5);
      const hw = f * sx * 0.5, hh = f * sy * 0.5;
      let X = f * (x + stageXs), Y = f * (y + stageYs);          // relative to the camera axis, phone heights
      const side = cfg[0] >= 0 ? 1 : -1;
      const behind = z < 0.06;
      const overlapsPhoneRows = Math.abs(Y - stageYs) < 0.5 + hh;
      const minD = (behind ? PHONE_HALF_W + 0.02 : 0.12) + hw;   // inner edge distance from the phone's centre line
      let deficit = 0;
      if (overlapsPhoneRows) {
        if ((X - stageXs) * side < minD) X = stageXs + side * minD;
      }
      const maxX = halfW - 0.035 - hw, maxY = halfH - 0.035 - hh;
      X = clamp(X, -maxX, maxX);
      Y = clamp(Y, -maxY, maxY);
      if (L.ceil) Y = Math.min(Y, (0.5 - L.ceil) * 2 * halfH - hh - 0.03);
      for (const av of L.avoid) {
        const aL = (av.l - 0.5) * 2 * halfW, aR = (av.r - 0.5) * 2 * halfW;
        const aT = (0.5 - av.t) * 2 * halfH, aB = (0.5 - av.b) * 2 * halfH, pad = 0.03;
        // wide screens: left-hand tags move into the gap between the copy and the phone (or dissolve below if it is too narrow)
        if (av.copy && !L.narrow && side < 0 && Y + hh > aB && Y - hh < aT) X = Math.max(X, aR + hw + pad + 0.004);
        // never under the text or the reminder: fade by how far the pill overlaps (continuous, so no on/off flicker at the edge)
        const ox = Math.min(X + hw, aR + pad) - Math.max(X - hw, aL - pad);
        const oy = Math.min(Y + hh, aT + pad) - Math.max(Y - hh, aB - pad);
        if (ox > 0 && oy > 0) a *= 1 - smooth(0.0, 0.06, Math.min(ox, oy));
      }
      if (overlapsPhoneRows && (X - stageXs) * side < minD) deficit = minD - (X - stageXs) * side;
      a *= 1 - smooth(0.0, 0.10, deficit);                         // no room beside the phone: dissolve instead of clipping or covering the middle
      if (L.narrow && !c.n) a = 0;                                 // a smaller set of tags on narrow screens
      x = X / f - stageXs;
      y = Y / f - stageYs;
      tg.mesh.position.set(x + ptr.sx * 0.02 * (z + 2), y - ptr.sy * 0.012 * (z + 2), z);
      tg.mesh.quaternion.copy(camera.quaternion);

      // angle of the tag around the disc centre, in the disc's own frame
      const ddx = tg.mesh.position.x - dl.x, ddy = tg.mesh.position.y - dl.y, ddz = tg.mesh.position.z - dl.z;
      const ly = ddy * ca + ddz * sa;
      const th = Math.atan2(ddx, ly);
      const dd = wrapPi(sweepDisc - th);
      if (!still && tg.prevDelta !== null && tg.prevDelta < 0 && dd >= 0 && dd < 1.0 && a > 0.4) tg.pingT = 0;
      tg.prevDelta = dd;
      if (!still) tg.pingT += dt;
      if (still && c.name === 'Disney+') tg.pingT = 0.12;

      tg.mesh.scale.set(sx, sy, 1);
      // ease each pill's opacity over time, so nothing can blink from one frame to the next
      tg.alphaS = still || tg.alphaS === undefined ? a : tg.alphaS + (a - tg.alphaS) * (1 - Math.exp(-dt * 7));
      tg.mat.opacity = tg.alphaS;
      tg.omat.opacity = pk * tg.alphaS;
      tg.mesh.visible = a > 0.003;
    }

    if (!still && t >= T_INTRO) markBanner();
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Texture, first frame
  // -----------------------------------------------------------------------------------------------------------------
  let texReady = false, firstFrame = false, shown = false, lost = false;
  function maybeShow() {
    if (shown || !texReady || !firstFrame || lost) return;
    shown = true;
    requestAnimationFrame(() => {
      canvas.style.opacity = '1';
      host.classList.add('is-3d');
    });
  }

  const loader = new THREE.TextureLoader();
  loader.load(new URL('./1-home.webp', import.meta.url).href, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    screenMat.map = tex;
    screenMat.needsUpdate = true;
    texReady = true;
    if (firstFrame) { if (staticMode()) renderOnce(); else draw(); }
    maybeShow();
    sync();
  }, undefined, () => {
    // no screen texture: keep the CSS fallback
    renderer.dispose();
    canvas.remove();
    dead = true;
  });

  // -----------------------------------------------------------------------------------------------------------------
  // Loop
  // -----------------------------------------------------------------------------------------------------------------
  let t = 0, last = 0, raf = 0, running = false, visible = true, dead = false;
  const staticMode = () => reduced() || FREEZE_AT !== null;

  function draw() {
    if (dead) return;
    renderer.render(scene, camera);
    if (!firstFrame) { firstFrame = true; maybeShow(); }
  }
  function renderOnce() {
    if (dead) return;
    if (FREEZE_AT !== null && !reduced()) {
      t = FREEZE_AT;
      update(t, 1 / 60, false);
      if (t >= T_INTRO) markBanner();
    } else {
      update(0, 1 / 60, true);
      markBanner();
    }
    draw();
  }

  // re-render the current state without moving the clock (resize, context restore) and without skipping the intro
  function renderCurrent() {
    if (dead) return;
    if (staticMode()) { renderOnce(); return; }
    update(t, 0, false);
    draw();
  }

  function frame(now) {
    raf = 0;
    if (!running || dead) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    t += dt;
    update(t, dt, false);
    draw();
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running || dead || staticMode()) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function sync() {
    if (texReady && visible && !document.hidden && !lost) start(); else stop();   // the clock waits for the screen texture, so the intro is seen from its first frame
  }

  // resize: renderer, camera and the anchor fit
  let resizeQueued = false;
  function onResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      if (dead) return;
      layout();
      if (staticMode() || !running) renderCurrent();
    });
  }
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    if (anchor) ro.observe(anchor);
  }
  window.addEventListener('resize', onResize);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      sync();
    }, { threshold: 0 }).observe(hero);
  }
  document.addEventListener('visibilitychange', sync);
  reduceMQ.addEventListener && reduceMQ.addEventListener('change', () => { if (reduced()) { stop(); renderOnce(); } else { renderCurrent(); sync(); } });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true; stop();
    host.classList.remove('is-3d');
    canvas.style.opacity = '0';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false; shown = false;
    renderCurrent(); maybeShow(); sync();
  });

  if (params.get('debug') === '1') window.__hero3d = {   // testing only
    renderer, scene, camera, tags,
    state() { return { t, running, visible, hidden: document.hidden, still: staticMode(), raf }; },
    measure() {                                   // the phone's projected centre line against the anchor, in CSS px
      stage.updateMatrixWorld(true);
      const a = rig.localToWorld(new THREE.Vector3(0, 0.5, THICK / 2)).project(camera);
      const b = rig.localToWorld(new THREE.Vector3(0, -0.5, THICK / 2)).project(camera);
      const hr = host.getBoundingClientRect(), ar = anchor ? anchor.getBoundingClientRect() : null;
      return {
        phoneH: Math.round((a.y - b.y) * 0.5 * L.h), phoneCx: Math.round(((a.x + b.x) * 0.25 + 0.5) * L.w), phoneCy: Math.round((0.5 - (a.y + b.y) * 0.25) * L.h),
        anchorH: ar ? Math.round(ar.height) : null, anchorCx: ar ? Math.round(ar.left + ar.width / 2 - hr.left) : null, anchorCy: ar ? Math.round(ar.top + ar.height / 2 - hr.top) : null,
      };
    },
  };
  layout();
  if (staticMode()) {
    renderOnce();
  } else {
    update(0, 0, false);
    draw();
    sync();
  }
}

(function () {
  const host = document.querySelector('[data-hero3d]');
  if (!host) return;
  try {
    boot(host);
  } catch (e) {
    console.error('[hero3d] could not start:', e);
    host.querySelectorAll('canvas').forEach((c) => c.remove());
    host.classList.remove('is-3d');
  }
})();
