import React, {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {edgesOf} from '../core/tin';
import {SNAP_LABELS} from '../core/snap';

const PICK_TOOLS = ['breakline', 'boundary', 'profile', 'platform', 'line'];
// projeto em tons de mina: corte = solo ferruginoso exposto; aterro = terra compactada; bermas/fundo = cascalho de estrada de mina
// Materiais compartilhados da camada de projeto: redesenhar não recompila shaders (antes, cada quadro do arraste
// descartava os materiais e o WebGL recompilava o programa)
const SHARED_MATS = new Map();
function sharedMat(key, make) { let m = SHARED_MATS.get(key); if (!m) { m = make(); m.userData.shared = true; SHARED_MATS.set(key, m); } return m; }
const DESIGN_COLORS = {platform: '#d3cdc0', cut: '#c25f34', fill: '#a08a5c', mixed: '#b07548', none: '#d3cdc0', wall: '#6f4a35', bench: '#ddd5c2', floor: '#cbc2ab', road: '#b98d5f'};

export default function ViewportV4(props) {
  const host = useRef(), labels = useRef(), cursor = useRef(), readout = useRef(), runtime = useRef(), latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState('');

  useEffect(() => {
    const el = host.current; let renderer;
    try { renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'}); }
    catch { setError('WebGL indisponível. Ative a aceleração gráfica do navegador.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); el.prepend(renderer.domElement);
    const is2D = props.mode === '2D';
    const camera = is2D ? new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 1e7) : new THREE.PerspectiveCamera(42, 1, .01, 1e7);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = !is2D; controls.enableZoom = false; controls.screenSpacePanning = true;
    controls.enableDamping = true; controls.dampingFactor = 0.22;
    if (is2D) controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    const state = {renderer, camera, controls, scene: new THREE.Scene(), frame: 0, w: 1, h: 1, span: 1, origin: new THREE.Vector3(), positions: [], edges: [], pointer: null, viewKey: '', contourLabels: [], textLabels: [], zoomPending: 0, zoomAnchor: null, zoomFrame: 0, inertia: 0, snap: null, surface: null};
    runtime.current = state;
    const screen = v => { const p = v.clone().project(camera); return {x: (p.x + 1) * state.w / 2, y: (1 - p.y) * state.h / 2, z: p.z}; };
    const toScreenXY = (x, y) => screen(new THREE.Vector3(x - state.origin.x, 0, -(y - state.origin.z)));
    state.screen = screen;
    function planCoordinate(x, y) {
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x / state.w * 2 - 1, 1 - y / state.h * 2), camera);
      const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      return hit ? {x: hit.x + state.origin.x, y: -hit.z + state.origin.z} : null;
    }
    const worldPerPixel = () => camera.isOrthographicCamera ? (camera.right - camera.left) / camera.zoom / Math.max(state.w, 1) : 1;
    function snapAt(x, y) {
      const p = latest.current; if (!p.snap || p.mode !== '2D' || !p.snapIndex) return null;
      const w = planCoordinate(x, y); if (!w) return null;
      const modes = p.tool === 'boundary' ? {node: true} : p.snapModes;
      const hit = p.snapIndex.query(w.x, w.y, p.snapAperture * worldPerPixel(), modes);
      if (!hit) return null;
      const s = toScreenXY(hit.x, hit.y); return {...hit, sx: s.x, sy: s.y};
    }
    function drawText(ctx, text, x, y, color, occupied) {
      const width = ctx.measureText(text).width, cells = [];
      for (let cx = Math.floor((x - 2) / 80); cx <= Math.floor((x + width + 2) / 80); cx++) cells.push(`${cx}:${Math.floor(y / 22)}`);
      if (occupied && cells.some(k => occupied.has(k))) return false;
      cells.forEach(k => occupied?.add(k));
      ctx.strokeStyle = '#101c28'; ctx.lineWidth = 3; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
      return true;
    }
    function snapMarker(ctx, s) {
      ctx.save(); ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2; const r = 7;
      ctx.beginPath();
      if (s.kind === 'node') ctx.rect(s.sx - r, s.sy - r, 2 * r, 2 * r);
      else if (s.kind === 'vertex') { ctx.moveTo(s.sx, s.sy - r); ctx.lineTo(s.sx + r, s.sy); ctx.lineTo(s.sx, s.sy + r); ctx.lineTo(s.sx - r, s.sy); ctx.closePath(); }
      else if (s.kind === 'midpoint') { ctx.moveTo(s.sx, s.sy - r); ctx.lineTo(s.sx + r, s.sy + r * .8); ctx.lineTo(s.sx - r, s.sy + r * .8); ctx.closePath(); }
      else { ctx.moveTo(s.sx - r, s.sy - r); ctx.lineTo(s.sx + r, s.sy + r); ctx.lineTo(s.sx - r, s.sy + r); ctx.lineTo(s.sx + r, s.sy - r); ctx.closePath(); }
      ctx.stroke();
      const p = latest.current, ref = s.kind === 'node' && Number.isInteger(s.ref) ? ' · ' + p.points[s.ref]?.id : '';
      ctx.font = '11px Consolas, monospace'; ctx.textBaseline = 'middle';
      const text = SNAP_LABELS[s.kind] + ref, tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(16,28,40,.92)'; ctx.fillRect(s.sx + 12, s.sy + 10, tw + 10, 18); ctx.fillStyle = '#ffd34d'; ctx.fillText(text, s.sx + 17, s.sy + 19);
      ctx.restore();
    }
    function draw() {
      state.frame = 0; renderer.render(state.scene, camera);
      const ctx = labels.current?.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0, 0, state.w, state.h);
      const p = latest.current, occupied = new Set(), inView = q => q.z >= -1 && q.z <= 1 && q.x >= 0 && q.x <= state.w && q.y >= 0 && q.y <= state.h;
      if (p.mode === '2D') {
        ctx.font = '11px Consolas, monospace'; ctx.textBaseline = 'middle';
        for (const l of state.textLabels) { const q = screen(l.v); if (inView(q)) drawText(ctx, l.text, q.x + (l.dx || 0), q.y + (l.dy || 0), l.color, occupied); }
        for (const l of state.designLabels || []) { const q = screen(l.v); if (inView(q)) drawText(ctx, l.text, q.x + (l.dx || 0), q.y + (l.dy || 0), l.color, occupied); }
        if (p.contourStyle?.visible2D && p.contourStyle.labels) { let count = 0; for (const label of state.contourLabels) { if (count >= 150) break; const q = screen(label.v); if (inView(q) && drawText(ctx, label.text, q.x - 14, q.y, '#fff1c2', occupied)) count++; } }
        if (p.layers.points && p.style.visible) {
          ctx.font = `${p.style.size}px Consolas, monospace`; let count = 0;
          for (const i of state.visible ?? []) {
            if (count >= 200) break;
            const q = screen(state.positions[i]); if (!inView(q)) continue;
            const point = p.points[i], text = [p.style.id ? point.id : '', p.style.elevation ? point.z.toFixed(p.style.precision) : '', p.style.description ? point.description : ''].filter(Boolean).join(' / ');
            if (text && drawText(ctx, text, q.x + 9, q.y, p.style.color, occupied)) count++;
          }
        }
      }
      // alças de edição (PIs da linha / vértices da plataforma selecionada)
      if (p.mode === '2D' && p.tool === 'orbit' && p.handles?.length) {
        ctx.save(); ctx.lineWidth = 1.5;
        for (const h of p.handles) {
          const q = toScreenXY(h.x, h.y), active = h.key === (state.drag?.key ?? p.activeHandle);
          ctx.fillStyle = active ? '#5fd4a6' : '#0e1821'; ctx.strokeStyle = active ? '#5fd4a6' : '#ffffff';
          ctx.fillRect(q.x - 5, q.y - 5, 10, 10); ctx.strokeRect(q.x - 5, q.y - 5, 10, 10);
        }
        ctx.restore();
      }
      // rascunho do desenho (linha elástica)
      const editor = (p.mode === '2D' && PICK_TOOLS.includes(p.tool)) || !!state.drag;
      let target = null;
      if (state.pointer) {
        const snap = editor ? snapAt(state.pointer.x, state.pointer.y) : null;
        state.snap = editor ? snap : null;
        const closing = editor && state.closeTarget?.(state.pointer.x, state.pointer.y);
        target = closing ? toScreenXY(closing.x, closing.y) : snap ? {x: snap.sx, y: snap.sy} : state.pointer;
        state.closing = !!closing;
        if (cursor.current) {
          cursor.current.style.display = p.crosshair && p.mode === '2D' ? 'block' : 'none';
          cursor.current.style.setProperty('--cursor-x', `${target.x}px`); cursor.current.style.setProperty('--cursor-y', `${target.y}px`);
          cursor.current.classList.toggle('snapped', !!snap);
        }
        if (snap && editor) snapMarker(ctx, snap);
        if (readout.current) {
          const w = snap ? {x: snap.x, y: snap.y} : planCoordinate(state.pointer.x, state.pointer.y);
          const node = snap?.kind === 'node' && Number.isInteger(snap.ref) ? p.points[snap.ref] : null;
          const z = node ? node.z : w && p.elevationAt ? p.elevationAt(w.x, w.y) : null;
          const dz = w && p.designAt ? p.designAt(w.x, w.y) : null;
          readout.current.textContent = w && p.mode === '2D' ? `${node ? '● ' + node.id + ' · ' : ''}E ${w.x.toFixed(3)}  N ${w.y.toFixed(3)}${z !== null && z !== undefined ? '  Z ' + z.toFixed(3) + (node ? '' : ' (TIN)') : ''}${dz !== null && dz !== undefined ? '  Proj ' + dz.toFixed(3) : ''}` : '';
        }
      }
      if (editor) {
        const verts = (p.tool === 'boundary' ? p.selected.map(i => p.points[i]) : p.pickDraft).map(v => toScreenXY(v.x, v.y));
        if (verts.length) {
          ctx.save(); ctx.strokeStyle = p.tool === 'platform' ? '#f2f5f7' : p.tool === 'profile' ? '#ff9de6' : '#ffcf75'; ctx.lineWidth = 2;
          ctx.beginPath(); verts.forEach((v, k) => k ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)); ctx.stroke();
          ctx.fillStyle = ctx.strokeStyle; verts.forEach(v => ctx.fillRect(v.x - 3, v.y - 3, 6, 6));
          if (verts.length >= 3 && ['platform', 'line'].includes(p.tool)) { // 1º vértice: alvo de fechamento
            ctx.save(); ctx.lineWidth = state.closing ? 2.5 : 1.2; ctx.strokeStyle = state.closing ? '#7dffb0' : 'rgba(242,245,247,.55)';
            ctx.beginPath(); ctx.arc(verts[0].x, verts[0].y, state.closing ? 10 : 7, 0, Math.PI * 2); ctx.stroke();
            if (state.closing) { ctx.font = '11px Consolas, monospace'; drawText(ctx, 'fechar', verts[0].x + 12, verts[0].y - 12, '#7dffb0'); }
            ctx.restore();
          }
          if (target) {
            ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(verts.at(-1).x, verts.at(-1).y); ctx.lineTo(target.x, target.y);
            if ((p.tool === 'platform' || p.tool === 'boundary') && verts.length > 1) ctx.lineTo(verts[0].x, verts[0].y);
            ctx.stroke();
            const a = verts.at(-1), w0 = planCoordinate(a.x, a.y), w1 = state.snap ? {x: state.snap.x, y: state.snap.y} : planCoordinate(target.x, target.y);
            if (w0 && w1) { const d = Math.hypot(w1.x - w0.x, w1.y - w0.y); ctx.setLineDash([]); ctx.font = '11px Consolas, monospace'; drawText(ctx, `${d.toFixed(2)} m`, (a.x + target.x) / 2 + 6, (a.y + target.y) / 2 - 10, '#ffe6a6'); }
          }
          ctx.restore();
        }
      }
    }
    const invalidate = () => { if (!state.frame) state.frame = requestAnimationFrame(draw); };
    state.invalidate = invalidate;
    const resize = () => {
      state.w = el.clientWidth; state.h = el.clientHeight; if (!state.w || !state.h) return;
      renderer.setSize(state.w, state.h);
      const ratio = Math.min(devicePixelRatio, 2); labels.current.width = state.w * ratio; labels.current.height = state.h * ratio; labels.current.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
      if (camera.isPerspectiveCamera) { camera.aspect = state.w / state.h; }
      else { const halfHeight = Math.max((state.extentX || state.span) * state.h / state.w, state.extentY || state.span, 1) * .62; camera.left = -halfHeight * state.w / state.h; camera.right = -camera.left; camera.top = halfHeight; camera.bottom = -camera.top; }
      camera.updateProjectionMatrix(); invalidate();
    };
    state.resize = resize;
    // ---- inércia (pan/órbita) ----
    const inertia = () => { state.inertia = 0; if (controls.update()) { invalidate(); state.inertia = requestAnimationFrame(inertia); } };
    controls.addEventListener('change', invalidate);
    controls.addEventListener('end', () => { cancelAnimationFrame(state.inertia); state.inertia = requestAnimationFrame(inertia); });
    // ---- zoom suave no cursor ----
    const ndc = (x, y) => new THREE.Vector2(x / state.w * 2 - 1, 1 - y / state.h * 2);
    function applyZoom(scale, anchor) {
      if (camera.isOrthographicCamera) {
        const before = new THREE.Vector3(ndc(anchor.x, anchor.y).x, ndc(anchor.x, anchor.y).y, 0).unproject(camera);
        camera.zoom = Math.min(1e5, Math.max(1e-3, camera.zoom / scale)); camera.updateProjectionMatrix();
        const after = new THREE.Vector3(ndc(anchor.x, anchor.y).x, ndc(anchor.x, anchor.y).y, 0).unproject(camera);
        const d = before.sub(after); d.y = 0; camera.position.add(d); controls.target.add(d);
      } else {
        const ray = new THREE.Raycaster(); ray.setFromCamera(ndc(anchor.x, anchor.y), camera);
        let P = state.surface ? ray.intersectObject(state.surface, false)[0]?.point : null;
        if (!P) P = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -controls.target.y), new THREE.Vector3());
        if (!P || P.distanceTo(camera.position) > state.span * 50) P = controls.target.clone();
        const dist = camera.position.distanceTo(P);
        if (scale < 1 && dist * scale < state.span * 0.003) return;
        if (scale > 1 && dist * scale > state.span * 40) return;
        camera.position.sub(P).multiplyScalar(scale).add(P); controls.target.sub(P).multiplyScalar(scale).add(P);
      }
      controls.update(); invalidate();
    }
    function zoomStep() {
      state.zoomFrame = 0;
      const step = Math.abs(state.zoomPending) < 0.002 ? state.zoomPending : state.zoomPending * 0.32;
      state.zoomPending -= step; applyZoom(Math.exp(step), state.zoomAnchor);
      if (Math.abs(state.zoomPending) > 1e-5) state.zoomFrame = requestAnimationFrame(zoomStep); else state.zoomPending = 0;
    }
    function wheel(e) {
      e.preventDefault();
      const r = el.getBoundingClientRect(), unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const delta = Math.max(-300, Math.min(300, e.deltaY * unit));
      state.zoomPending += delta * 0.0019 * (latest.current.zoomSensitivity || 1);
      state.zoomAnchor = {x: e.clientX - r.left, y: e.clientY - r.top};
      if (!state.zoomFrame) state.zoomFrame = requestAnimationFrame(zoomStep);
    }
    el.addEventListener('wheel', wheel, {passive: false});
    const observer = new ResizeObserver(resize); observer.observe(el);
    // fechamento do polígono: 1º vértice do rascunho a menos de 12 px (plataforma e linha)
    const closeTarget = (x, y) => {
      const p = latest.current; if (!['platform', 'line'].includes(p.tool) || (p.pickDraft?.length ?? 0) < 3) return null;
      const f = p.pickDraft[0], q = toScreenXY(f.x, f.y); return Math.hypot(q.x - x, q.y - y) < 12 ? f : null;
    };
    state.closeTarget = closeTarget;
    const handleAt = (x, y, radius = 8) => {
      const p = latest.current; if (p.mode !== '2D' || p.tool !== 'orbit' || !p.handles?.length) return null;
      let best = null, bd = radius;
      for (const h of p.handles) { const q = toScreenXY(h.x, h.y), d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = h; } }
      return best;
    };
    const segmentAt = (x, y, radius = 6) => {
      const p = latest.current; if (p.mode !== '2D' || p.tool !== 'orbit' || !p.segments?.length) return null;
      let best = null, bd = radius;
      for (const sg of p.segments) {
        const a = toScreenXY(sg.a.x, sg.a.y), b = toScreenXY(sg.b.x, sg.b.y), dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
        if (d < bd) { bd = d; best = sg; }
      }
      return best;
    };
    const dragDown = e => {
      if (e.button !== 0) return;
      const r = el.getBoundingClientRect(), h = handleAt(e.clientX - r.left, e.clientY - r.top); if (!h) return;
      e.stopPropagation(); e.preventDefault();
      state.drag = {key: h.key, x: h.x, y: h.y}; state.dragPos = {x: h.x, y: h.y}; state.ignoreUp = true; controls.enabled = false;
      latest.current.onHandleDrag?.(h.key, {x: h.x, y: h.y}, 'start'); invalidate();
    };
    const dragTo = (x, y, free) => {
      let s = free ? null : snapAt(x, y);
      if (s && Math.hypot(s.x - state.drag.x, s.y - state.drag.y) < 1e-9) s = null; // não atrair para a própria posição antiga
      const w = s ? {x: s.x, y: s.y} : planCoordinate(x, y); if (!w) return;
      state.dragPos = w;
      if (!state.dragFrame) state.dragFrame = requestAnimationFrame(() => { state.dragFrame = 0; if (state.drag) latest.current.onHandleDrag?.(state.drag.key, state.dragPos, 'move'); });
    };
    const dragUp = () => {
      if (!state.drag) return;
      cancelAnimationFrame(state.dragFrame); state.dragFrame = 0;
      const {key} = state.drag; state.drag = null; state.ignoreUp = false; controls.enabled = true; // soltou fora do desenho: o próximo clique vale
      latest.current.onHandleDrag?.(key, state.dragPos, 'end'); invalidate();
    };
    const dragKey = e => { if (e.key === 'Escape' && state.drag) { const {key, x, y} = state.drag; state.drag = null; controls.enabled = true; latest.current.onHandleDrag?.(key, {x, y}, 'cancel'); invalidate(); } };
    const contextMenu = e => { const r = el.getBoundingClientRect(), h = handleAt(e.clientX - r.left, e.clientY - r.top); if (h) { e.preventDefault(); latest.current.onHandleRemove?.(h.key); } };
    el.addEventListener('pointerdown', dragDown, {capture: true}); window.addEventListener('pointerup', dragUp); window.addEventListener('keydown', dragKey); el.addEventListener('contextmenu', contextMenu);
    const move = e => { const r = el.getBoundingClientRect(); state.pointer = {x: e.clientX - r.left, y: e.clientY - r.top}; if (state.drag) dragTo(state.pointer.x, state.pointer.y, e.altKey); invalidate(); };
    const leave = () => { state.pointer = null; state.snap = null; if (cursor.current) cursor.current.style.display = 'none'; invalidate(); };
    let down;
    const start = e => { down = {x: e.clientX, y: e.clientY, button: e.button}; };
    const end = e => {
      const p = latest.current;
      if (state.ignoreUp) { state.ignoreUp = false; return; }
      if (!down || down.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || p.mode !== '2D') return;
      const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (PICK_TOOLS.includes(p.tool)) {
        const f = closeTarget(x, y); // perto do 1º vértice: fecha (mesmo com a atração desligada)
        if (f) { p.onPick({x: f.x, y: f.y, close: true}); return; }
        const s = snapAt(x, y), w = s ? {x: s.x, y: s.y} : planCoordinate(x, y);
        if (!w) return;
        p.onPick({x: w.x, y: w.y, index: s?.kind === 'node' && Number.isInteger(s.ref) ? s.ref : undefined, kind: s?.kind});
        return;
      }
      if (['swap', 'delete'].includes(p.tool)) {
        let best = null, distance = 12;
        for (const edge of state.edges) {
          const a = screen(state.positions[edge.a]), b = screen(state.positions[edge.b]);
          if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue;
          const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
          if (d < distance) { distance = d; best = edge; }
        }
        if (best) p.onEdge(best.a, best.b);
        return;
      }
      if (p.tool === 'orbit' && !handleAt(x, y)) { const sg = segmentAt(x, y); if (sg && p.onSegmentInsert) { const w = planCoordinate(x, y); if (w) p.onSegmentInsert(sg.key, w); return; } }
      if (p.tool === 'orbit' && p.onPlanClick) { const w = planCoordinate(x, y); if (w) p.onPlanClick(w); }
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    renderer.domElement.addEventListener('pointerdown', start); renderer.domElement.addEventListener('pointerup', end);
    const lost = e => { e.preventDefault(); setError('Contexto gráfico perdido. Recarregue a página para restaurar.'); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      cancelAnimationFrame(state.frame); cancelAnimationFrame(state.zoomFrame); cancelAnimationFrame(state.inertia); observer.disconnect(); controls.dispose();
      el.removeEventListener('pointerdown', dragDown, {capture: true}); window.removeEventListener('pointerup', dragUp); window.removeEventListener('keydown', dragKey); el.removeEventListener('contextmenu', contextMenu); cancelAnimationFrame(state.dragFrame);
      el.removeEventListener('wheel', wheel); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave);
      disposeScene(state.scene); renderer.dispose(); renderer.domElement.remove(); runtime.current = null;
    };
  }, []);

  const plan = props.mode === '2D';
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    const {points, triangles, terrain3D, constraints, mode, tool, visibleIndices, layers, presentation, groupColors, boundary, fitKey, contours, contourStyle, alignment, profileSamples, referenceZ, designs, selectedPlatform, selectedLine, sectionLines, currentStation, gradeLine3D} = props;
    disposeScene(r.scene); const scene = new THREE.Scene(); scene.background = new THREE.Color(mode === '2D' ? '#0e1821' : '#111d28'); r.scene = scene; r.surface = null;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2, span = Math.max(maxX - minX, maxY - minY, 1);
    r.span = span; r.extentX = maxX - minX; r.extentY = maxY - minY; r.origin.set(cx, cz, cy);
    const lift = mode === '2D' ? 0 : Math.max(maxZ - minZ, 1) * 0.004;
    const world = (x, y, z = cz) => new THREE.Vector3(x - cx, mode === '2D' ? 0 : z - cz, -(y - cy));
    r.positions = points.map(p => world(p.x, p.y, p.z)); r.visible = visibleIndices; r.edges = edgesOf(triangles);
    const viewKey = `${minX}:${minY}:${maxX}:${maxY}:${fitKey}`;
    if (r.viewKey !== viewKey) {
      r.viewKey = viewKey; r.controls.target.set(0, 0, 0); r.camera.zoom = 1; r.camera.up.set(0, 1, 0);
      r.camera.position.set(mode === '2D' ? 0 : span * .65, span * 1.5, mode === '2D' ? .00001 : span * 1.2); r.camera.lookAt(0, 0, 0);
      r.camera.far = span * 100 + Math.abs(maxZ - minZ) * 10; r.camera.updateProjectionMatrix(); r.controls.update();
    }
    r.controls.enabled = tool === 'orbit' || mode === '3D' || PICK_TOOLS.includes(tool);
    r.renderer.domElement.style.cursor = mode === '2D' && props.crosshair ? 'none' : 'grab';
    if (mode === '2D' ? layers.grid : presentation.grid) { const grid = new THREE.GridHelper(span * 4, 40, '#345165', '#263c4d'); grid.position.y = mode === '2D' ? -.03 : minZ - cz - span * .04; scene.add(grid); }
    const clipped = mode === '3D' && terrain3D ? terrain3D : null;
    const surfVerts = clipped ? clipped.vertices : points, surfTris = clipped ? clipped.triangles : triangles;
    if (surfTris.length) {
      const positions = new Float32Array(surfVerts.length * 3), colors = new Float32Array(surfVerts.length * 3), color = new THREE.Color();
      surfVerts.forEach((p, i) => { world(p.x, p.y, p.z).toArray(positions, i * 3); const t = (p.z - minZ) / Math.max(maxZ - minZ, .001); hypsometric(Math.min(1, Math.max(0, t)), presentation.style, color); color.toArray(colors, i * 3); });
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(surfTris.flat()); geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({color: presentation.style === 'solid' && mode === '3D' ? '#8f9a72' : '#ffffff', vertexColors: presentation.style !== 'solid' || mode === '2D', side: THREE.DoubleSide, roughness: .9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, wireframe: mode === '3D' && presentation.style === 'wire'});
      const mesh = new THREE.Mesh(geometry, material); scene.add(mesh); r.surface = mesh;
    }
    scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x2b2418, mode === '2D' ? 1.5 : 1.05)); scene.add(new THREE.AmbientLight(0xffffff, mode === '2D' ? .55 : .3));
    const light = new THREE.DirectionalLight(0xfff1dc, mode === '2D' ? 1.3 : 2.4); light.position.set(-span * .8, span * 1.1, span * .6); scene.add(light);
    const fillLight = new THREE.DirectionalLight(0x9fc4ff, .35); fillLight.position.set(span, span * .5, -span); scene.add(fillLight);
    const segments = (vectors, color, opacity = 1, depthTest = false) => {
      if (!vectors.length) return;
      const positions = new Float32Array(vectors.length * 3); vectors.forEach((v, i) => v.toArray(positions, i * 3));
      scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)), new THREE.LineBasicMaterial({color, transparent: opacity < 1, opacity, depthTest})));
    };
    const lines = (pairs, color, opacity = 1) => segments(pairs.flatMap(([a, b]) => [r.positions[a], r.positions[b]]), color, opacity);
    const polyline = (coords, closed = false) => { const out = []; for (let i = 1; i < coords.length; i++) out.push(coords[i - 1], coords[i]); if (closed && coords.length > 2) out.push(coords.at(-1), coords[0]); return out; };
    r.contourLabels = []; r.textLabels = [];
    if (contours && (mode === '2D' ? contourStyle.visible2D : contourStyle.visible3D)) {
      const minor = [], major = [];
      for (const level of contours.levels) for (const line of level.lines) {
        const vs = line.coords.map(([x, y]) => world(x, y, level.z + lift));
        const segs = polyline(vs, line.closed);
        if (mode === '3D' && props.designAt) { // no 3D, oculta curvas do terreno original sob a terraplenagem
          for (let k = 0; k < segs.length; k += 2) { const a = segs[k], b = segs[k + 1], mx = (a.x + b.x) / 2 + cx, my = -(a.z + b.z) / 2 + cy; if (props.designAt(mx, my) === null) (level.major ? major : minor).push(a, b); }
        } else (level.major ? major : minor).push(...segs);
        if (level.major && mode === '2D' && vs.length > 1) r.contourLabels.push({v: vs[Math.floor(vs.length / 2)], text: level.z.toFixed(level.z % 1 ? 2 : 0)});
      }
      segments(minor, mode === '2D' ? '#4d7c82' : '#36525a', mode === '2D' ? .75 : .55, mode === '3D');
      segments(major, mode === '2D' ? '#163541' : '#203640', mode === '2D' ? 1 : .9, mode === '3D');
    }
    if (mode === '2D' && layers.edges) lines(r.edges.map(e => [e.a, e.b]), '#648c94', contourStyle?.visible2D ? .35 : .7);
    if (mode === '2D' && layers.breaklines) lines(constraints, '#ffbd70');
    if (mode === '2D' && layers.border) lines(r.edges.filter(e => e.faces.length === 1).map(e => [e.a, e.b]), '#a9e6ce');
    if (mode === '2D' && boundary.length) lines(boundary.map((i, k) => [i, boundary[(k + 1) % boundary.length]]), '#67c4ff');
    // ---- Projeto (plataformas e linhas): camada própria, redesenhada sozinha durante o arraste ----
    r.world = world; r.lift = lift; r.mode = mode; r.segmentsTo = (target, vectors, color, opacity = 1, depthTest = false) => {
      if (!vectors.length) return;
      const positions = new Float32Array(vectors.length * 3); vectors.forEach((v, i) => v.toArray(positions, i * 3));
      target.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)), sharedMat(`line:${color}:${opacity}:${depthTest}`, () => new THREE.LineBasicMaterial({color, transparent: opacity < 1, opacity, depthTest}))));
    };
    r.designGroup = new THREE.Group(); scene.add(r.designGroup); r.designLabels = [];
    drawDesigns(r, latest.current);
    // ---- Eixo, seções e greide ----
    if (mode === '2D') {
      if (alignment.length > 1) {
        segments(polyline(alignment.map(p => world(p.x, p.y))), '#ff7ad9');
        r.textLabels.push({v: world(alignment[0].x, alignment[0].y), text: '0+000', color: '#ff9de6', dx: 6, dy: -12});
      }
    } else {
      if (profileSamples?.length) { const out = []; let prev = null; for (const s of profileSamples) { const v = s.z === null ? null : world(s.x, s.y, s.z + lift * 2); if (v && prev) out.push(prev, v); prev = v; } segments(out, '#ff5fcf', 1, true); }
    }
    // seções, greide e estaca ativa: camada própria (mudam a cada quadro do arraste do PVI sem refazer o terreno)
    r.zRange = {minZ, maxZ}; r.overlayGroup = new THREE.Group(); scene.add(r.overlayGroup);
    drawOverlay(r, latest.current);
    if (mode === '3D' && Number.isFinite(referenceZ) && presentation.referencePlane && triangles.length) {
      const positions = new Float32Array(points.length * 3);
      points.forEach((p, i) => world(p.x, p.y, referenceZ).toArray(positions, i * 3));
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(triangles.flat());
      scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: '#5db8ff', transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false})));
    }
    const makePoints = (indices, size, selectedColor) => {
      if (!indices.length) return;
      const v = new Float32Array(indices.length * 3), colors = new Float32Array(indices.length * 3), color = new THREE.Color();
      indices.forEach((i, k) => { r.positions[i].toArray(v, k * 3); color.set(selectedColor || groupColors[points[i].description.trim() || 'Sem descrição'] || '#d8eee5').toArray(colors, k * 3); });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(v, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      scene.add(new THREE.Points(geo, new THREE.PointsMaterial({size, vertexColors: true, sizeAttenuation: false, depthTest: false})));
    };
    if (mode === '2D' && layers.points) makePoints(visibleIndices, 5);
    r.resize(); r.invalidate();
  }, [props.points, props.triangles, props.mode, props.presentation, props.fitKey, props.contours, props.contourStyle?.visible2D, props.contourStyle?.visible3D,
    plan ? props.constraints : null, plan ? props.visibleIndices : null, plan ? props.layers : null, plan ? props.groupColors : null, plan ? props.boundary : null,
    plan ? props.alignment : null,
    plan ? null : props.terrain3D, plan ? null : props.designAt, plan ? null : props.profileSamples, plan ? null : props.referenceZ]);
  useEffect(() => { const r = runtime.current; if (!r?.overlayGroup) return; drawOverlay(r, props); r.invalidate(); }, [props.sectionLines, props.currentStation, props.gradeLine3D]);
  // camada de projeto: redesenha só ela quando plataformas/linhas mudam (arraste fluido, sem refazer o terreno)
  useEffect(() => { const r = runtime.current; if (!r?.designGroup) return; drawDesigns(r, props); r.invalidate(); }, [props.designs, props.finalSurface, props.selectedPlatform, props.selectedLine]);
  useEffect(() => {
    const r = runtime.current;
    if (r) { r.controls.enabled = props.tool === 'orbit' || props.mode === '3D' || PICK_TOOLS.includes(props.tool); r.renderer.domElement.style.cursor = props.mode === '2D' && props.crosshair ? 'none' : 'grab'; r.invalidate(); }
  }, [props.style, props.crosshair, props.snap, props.tool, props.contourStyle?.labels, props.pickDraft, props.selected, props.snapIndex, props.snapModes, props.snapAperture, props.handles, props.activeHandle]);
  return <div className="viewport" ref={host}>
    <canvas className="label-overlay" ref={labels} aria-hidden="true"/>
    <div className="cad-crosshair" ref={cursor} aria-hidden="true"><i className="cross-x"/><i className="cross-y"/><i className="pickbox"/></div>
    <div className="coordinate-readout" ref={readout}/>
    {error && <p className="viewport-error" role="alert">{error}</p>}
  </div>;
}

const HYPSO = [[0, '#1f4a24'], [.25, '#3f7a34'], [.5, '#8f9a45'], [.75, '#b8743a'], [1, '#8e3a22']].map(([t, c]) => [t, new THREE.Color(c)]);
// Carajás: mata amazônica nas cotas baixas → dossel → oliva → canga/laterita ferruginosa nos platôs
const CONCEPT = [[0, '#23502a'], [.3, '#3d7334'], [.55, '#6d8c3c'], [.78, '#a5874a'], [.92, '#b4643a'], [1, '#93412a']].map(([t, c]) => [t, new THREE.Color(c)]);
function hypsometric(t, style, out) {
  if (style !== 'hypso') { for (let i = 1; i < CONCEPT.length; i++) if (t <= CONCEPT[i][0]) return out.copy(CONCEPT[i - 1][1]).lerp(CONCEPT[i][1], (t - CONCEPT[i - 1][0]) / (CONCEPT[i][0] - CONCEPT[i - 1][0])); return out.copy(CONCEPT.at(-1)[1]); }
  for (let i = 1; i < HYPSO.length; i++) if (t <= HYPSO[i][0]) return out.copy(HYPSO[i - 1][1]).lerp(HYPSO[i][1], (t - HYPSO[i - 1][0]) / (HYPSO[i][0] - HYPSO[i - 1][0]));
  return out.copy(HYPSO.at(-1)[1]);
}
/** Desenha plataformas e linhas de projeto no grupo próprio da cena (sem reconstruir o terreno). */
function drawOverlay(r, props) {
  const group = r.overlayGroup; if (!group) return;
  group.traverse(o => { if (o !== group) { o.geometry?.dispose(); if (!o.material?.userData?.shared) o.material?.dispose(); } }); group.clear();
  const {sectionLines, currentStation, gradeLine3D} = props, world = r.world, lift = r.lift, segments = (v, c, op = 1, dt = false) => r.segmentsTo(group, v, c, op, dt);
  const polyline = (coords, closed = false) => { const out = []; for (let i = 1; i < coords.length; i++) out.push(coords[i - 1], coords[i]); if (closed && coords.length > 2) out.push(coords.at(-1), coords[0]); return out; };
  const hasCur = currentStation !== null && currentStation !== undefined;
  if (r.mode === '2D') {
    if (!sectionLines?.length) return;
    const all = [], cur = [];
    for (const s of sectionLines) (hasCur && Math.abs(s.station - currentStation) < 1e-6 ? cur : all).push(world(s.left.x, s.left.y), world(s.right.x, s.right.y));
    segments(all, '#5fd3e6', .85); segments(cur, '#ffe066', 1);
    return;
  }
  if (gradeLine3D?.length > 1) segments(polyline(gradeLine3D.map(p => world(p.x, p.y, p.z + lift))), '#ff3b5c', 1, false);
  const cs = hasCur ? (sectionLines || []).find(s => Math.abs(s.station - currentStation) < 1e-6) : null;
  if (cs) { // seção ativa: plano vertical translúcido com contorno ciano
    const {minZ, maxZ} = r.zRange, z0 = minZ - (maxZ - minZ) * .15 - 1, z1 = maxZ + (maxZ - minZ) * .25 + 1, q = [world(cs.left.x, cs.left.y, z0), world(cs.right.x, cs.right.y, z0), world(cs.right.x, cs.right.y, z1), world(cs.left.x, cs.left.y, z1)];
    const pos = new Float32Array(18); [q[0], q[1], q[2], q[0], q[2], q[3]].forEach((v, k) => v.toArray(pos, k * 3));
    group.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)), sharedMat('section-plane', () => new THREE.MeshBasicMaterial({color: '#00ffd0', transparent: true, opacity: .16, side: THREE.DoubleSide, depthWrite: false}))));
    segments(polyline(q, true), '#00ffd0', 1, false);
  }
}

function drawDesigns(r, props) {
  const group = r.designGroup; if (!group) return;
  group.traverse(o => { if (o !== group) { o.geometry?.dispose(); if (!o.material?.userData?.shared) o.material?.dispose(); } }); group.clear();
  const labels = r.designLabels = [], {designs, selectedPlatform, selectedLine, finalSurface} = props, mode = r.mode, world = r.world, lift = r.lift;
  const faces = m => {
    if (!m.triangles.length) return;
    const pos = new Float32Array(m.triangles.length * 9), col = new Float32Array(m.triangles.length * 9), c = new THREE.Color();
    m.triangles.forEach((t, k) => { c.set(DESIGN_COLORS[m.types[k]] || '#b9c0c7'); t.forEach((i, j) => { const v = m.vertices[i]; world(v.x, v.y, v.z + lift * .5).toArray(pos, k * 9 + j * 3); c.toArray(col, k * 9 + j * 3); }); });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, sharedMat('design-faces', () => new THREE.MeshStandardMaterial({vertexColors: true, side: THREE.DoubleSide, roughness: .88, flatShading: true}))));
  };
  // no 3D, a face do projeto é a superfície final combinada (objetos sobrepostos já resolvidos)
  const final3D = mode === '3D' && finalSurface?.triangles?.length;
  if (final3D) faces(finalSurface);
  const segments = (vectors, color, opacity = 1, depthTest = false) => r.segmentsTo(group, vectors, color, opacity, depthTest);
  const polyline = (coords, closed = false) => { const out = []; for (let i = 1; i < coords.length; i++) out.push(coords[i - 1], coords[i]); if (closed && coords.length > 2) out.push(coords.at(-1), coords[0]); return out; };
    // ---- Projeto: linhas de projeto ----
  function drawLine(d) {
    const {line, mesh: m} = d, sel = line.id === selectedLine, base = m.base || [];
    if (base.length < 2) return;
    if (mode === '3D') {
      if (!final3D) faces(m);
      segments(m.hatch.flatMap(([a, b]) => [world(a.x, a.y, a.z + lift * 1.5), world(b.x, b.y, b.z + lift * 1.5)]), '#3a2418', .55, true); // hachura técnica nas rampas
      (m.daylightRuns || []).forEach(run => segments(polyline(run.map(v => world(v.x, v.y, v.z + lift))), '#7dffb0', 1, true));
      (m.benchLines || []).forEach(l => segments(polyline(l.map(v => world(v.x, v.y, v.z + lift))), '#ffd27a', .95, true));
      segments(polyline(base.map(v => world(v.x, v.y, v.z + lift)), line.closed), sel ? '#ffffff' : '#ffe9a8', 1, true);
      return;
    }
    const cutHatch = [], fillHatch = [];
    m.hatch.forEach(([a, b, md]) => (md === 'cut' ? cutHatch : fillHatch).push(world(a.x, a.y), world(b.x, b.y)));
    segments(cutHatch, '#ff9f6b', .8); segments(fillHatch, '#6fc3ff', .8);
    (m.daylightRuns || []).forEach(run => segments(polyline(run.map(v => world(v.x, v.y))), '#7dffb0'));
    (m.benchLines || []).forEach(l => segments(polyline(l.map(v => world(v.x, v.y))), '#ffd27a', .7));
    segments(polyline(base.map(v => world(v.x, v.y)), line.closed), sel ? '#ffffff' : '#ffe08a');
    // PIs como quadrados e estacas ao longo da linha
    const piPos = new Float32Array(line.pis.length * 3); line.pis.forEach((p, i) => world(p.x, p.y).toArray(piPos, i * 3));
    group.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(piPos, 3)), sharedMat(`pi:${sel}`, () => new THREE.PointsMaterial({size: sel ? 9 : 7, color: sel ? '#ffffff' : '#ffe08a', sizeAttenuation: false, depthTest: false}))));
    line.pis.forEach((p, i) => labels.push({v: world(p.x, p.y), text: `PI${i + 1}`, color: sel ? '#ffffff' : '#ffe9a8', dx: 6, dy: -10}));
    const step = (m.length || 0) > 400 ? 100 : 20;
    for (let st = step; st < (m.length || 0) - 1e-6; st += step) {
      let k = 1; while (k < base.length - 1 && base[k].s < st) k++;
      const a = base[k - 1], b = base[k], t = b.s > a.s ? (st - a.s) / (b.s - a.s) : 0;
      labels.push({v: world(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y)), text: `${Math.floor(st / 1000)}+${String(Math.round(st % 1000)).padStart(3, '0')}`, color: '#c9b37a', dx: 4, dy: 10});
    }
    labels.push({v: world(base[0].x, base[0].y), text: line.name, color: sel ? '#ffffff' : '#ffe9a8', dx: 6, dy: 14});
  }
  // ---- Projeto: acesso (gabarito aplicado no eixo + greide) ----
  function drawCorridor(d) {
    const m = d.mesh, edges = m.edges || {left: [], right: []}, axis = m.axis || [];
    if (axis.length < 2) return;
    const edgeRuns = m.edgeRuns || [edges.left, edges.right];
    if (mode === '3D') {
      if (!final3D) faces(m);
      segments(m.hatch.flatMap(([a, b]) => [world(a.x, a.y, a.z + lift * 1.5), world(b.x, b.y, b.z + lift * 1.5)]), '#3a2418', .55, true);
      (m.daylightRuns || []).forEach(run => segments(polyline(run.map(v => world(v.x, v.y, v.z + lift))), '#7dffb0', 1, true));
      (m.benchLines || []).forEach(l => segments(polyline(l.map(v => world(v.x, v.y, v.z + lift))), '#ffd27a', .95, true));
      edgeRuns.forEach(e => segments(polyline(e.map(v => world(v.x, v.y, v.z + lift))), '#fff1d6', 1, true));
      return;
    }
    const strip = [];
    m.triangles.forEach((t, k) => { if (m.types[k] === 'road') t.forEach(i => strip.push(world(m.vertices[i].x, m.vertices[i].y))); });
    if (strip.length) { const g2 = new THREE.BufferGeometry().setFromPoints(strip); group.add(new THREE.Mesh(g2, sharedMat('road2d', () => new THREE.MeshBasicMaterial({color: '#c99a68', transparent: true, opacity: .42, side: THREE.DoubleSide, depthTest: false})))); }
    const cutHatch = [], fillHatch = [];
    m.hatch.forEach(([a, b, md]) => (md === 'cut' ? cutHatch : fillHatch).push(world(a.x, a.y), world(b.x, b.y)));
    segments(cutHatch, '#ff9f6b', .8); segments(fillHatch, '#6fc3ff', .8);
    (m.daylightRuns || []).forEach(run => segments(polyline(run.map(v => world(v.x, v.y))), '#7dffb0'));
    (m.benchLines || []).forEach(l => segments(polyline(l.map(v => world(v.x, v.y))), '#ffd27a', .7));
    edgeRuns.forEach(e => segments(polyline(e.map(v => world(v.x, v.y))), '#fff1d6'));
    labels.push({v: world(axis[0].x, axis[0].y), text: `Acesso · pista ${d.corridor.width.toLocaleString('pt-BR')} m`, color: '#ffe3bf', dx: 6, dy: 26});
  }
  // ---- Projeto: plataformas e taludes ----
  for (const d of designs || []) {
    if (d.kind === 'line') { drawLine(d); continue; }
    if (d.kind === 'corridor') { drawCorridor(d); continue; }
    const sel = d.platform.id === selectedPlatform;
    if (mode === '3D') {
      if (!final3D) faces(d.mesh);
      segments(d.mesh.hatch.flatMap(([a, b]) => [world(a.x, a.y, a.z + lift * 1.5), world(b.x, b.y, b.z + lift * 1.5)]), '#3a2418', .55, true); // hachura técnica nas rampas
      (d.mesh.daylightRuns || (d.mesh.daylight.length ? [[...d.mesh.daylight, d.mesh.daylight[0]]] : [])).forEach(run => segments(polyline(run.map(v => world(v.x, v.y, v.z + lift))), '#7dffb0', 1, true));
      segments(polyline(d.platform.polygon.map(v => world(v.x, v.y, (Number.isFinite(v.z) ? v.z : d.platform.elevation) + lift)), true), sel ? '#ffffff' : '#e7edf2', 1, true);
      (d.mesh.benchLines || []).forEach(l => segments(polyline(l.map(v => world(v.x, v.y, v.z + lift))), '#ffd27a', .95, true));
    } else {
      const pos = new Float32Array(d.mesh.triangles.length * 9); let k = 0;
      d.mesh.triangles.forEach((t, n) => { if (d.mesh.types[n] !== 'platform') return; t.forEach(i => { const v = d.mesh.vertices[i]; world(v.x, v.y).toArray(pos, k); k += 3; }); });
      const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k), 3));
      group.add(new THREE.Mesh(g2, sharedMat(`plat2d:${sel}`, () => new THREE.MeshBasicMaterial({color: sel ? '#d7dee5' : '#9aa7b2', transparent: true, opacity: sel ? .45 : .3, side: THREE.DoubleSide, depthTest: false}))));
      const cutHatch = [], fillHatch = [];
      d.mesh.hatch.forEach(([a, b, m]) => (m === 'cut' ? cutHatch : fillHatch).push(world(a.x, a.y), world(b.x, b.y)));
      segments(cutHatch, '#ff9f6b', .8); segments(fillHatch, '#6fc3ff', .8);
      (d.mesh.daylightRuns || (d.mesh.daylight.length ? [[...d.mesh.daylight, d.mesh.daylight[0]]] : [])).forEach(run => segments(polyline(run.map(v => world(v.x, v.y))), '#7dffb0'));
      (d.mesh.benchLines || []).forEach(l => segments(polyline(l.map(v => world(v.x, v.y))), '#ffd27a', .7));
      segments(polyline(d.platform.polygon.map(v => world(v.x, v.y)), true), sel ? '#ffffff' : '#e7edf2');
      const c = d.platform.polygon.reduce((s, v) => ({x: s.x + v.x / d.platform.polygon.length, y: s.y + v.y / d.platform.polygon.length}), {x: 0, y: 0});
      labels.push({v: world(c.x, c.y), text: `${d.platform.name} · ${d.platform.polygon.some(v => Number.isFinite(v.z) && Math.abs(v.z - d.platform.elevation) > 1e-9) ? 'rampa ' + Math.min(...d.platform.polygon.map(v => Number.isFinite(v.z) ? v.z : d.platform.elevation)).toFixed(2) + '–' + Math.max(...d.platform.polygon.map(v => Number.isFinite(v.z) ? v.z : d.platform.elevation)).toFixed(2) : d.platform.elevation.toFixed(2)}`, color: sel ? '#ffffff' : '#dfe7ee', dx: -40});
    }
  }
}

function disposeScene(scene) { scene.traverse(o => { o.geometry?.dispose(); if (o.material && !o.material.userData?.shared) { o.material.map?.dispose(); o.material.dispose(); } }); scene.clear(); }
