import React, {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {edgesOf} from '../core/tin';

const PICK_TOOLS = ['breakline', 'boundary', 'profile'];

export default function ViewportV3(props) {
  const host = useRef(), labels = useRef(), cursor = useRef(), readout = useRef(), runtime = useRef(), latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState('');

  useEffect(() => {
    const el = host.current; let renderer;
    try { renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false}); }
    catch { setError('WebGL indisponível. Ative a aceleração gráfica do navegador.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); el.prepend(renderer.domElement);
    const camera = props.mode === '2D' ? new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 1e7) : new THREE.PerspectiveCamera(42, 1, .01, 1e7);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = props.mode !== '2D'; controls.enableDamping = false; controls.screenSpacePanning = true;
    if (props.mode === '2D') controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    const state = {renderer, camera, controls, scene: new THREE.Scene(), frame: 0, w: 1, h: 1, span: 1, origin: new THREE.Vector3(), positions: [], edges: [], pointer: null, viewKey: '', contourLabels: []};
    runtime.current = state;
    const screen = v => { const p = v.clone().project(camera); return {x: (p.x + 1) * state.w / 2, y: (1 - p.y) * state.h / 2, z: p.z}; };
    state.screen = screen;
    function nearest(x, y, radius = 22) {
      let best = null, distance = radius;
      for (const i of state.visible ?? []) { const p = screen(state.positions[i]), d = Math.hypot(x - p.x, y - p.y); if (p.z >= -1 && p.z <= 1 && d < distance) { distance = d; best = {i, ...p}; } }
      return best;
    }
    function planCoordinate(x, y) {
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x / state.w * 2 - 1, 1 - y / state.h * 2), camera);
      const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      return hit ? {x: hit.x + state.origin.x, y: -hit.z + state.origin.z} : null;
    }
    function drawText(ctx, text, x, y, color, occupied) {
      const width = ctx.measureText(text).width, cells = [];
      for (let cx = Math.floor((x - 2) / 80); cx <= Math.floor((x + width + 2) / 80); cx++) cells.push(`${cx}:${Math.floor(y / 22)}`);
      if (cells.some(k => occupied.has(k))) return false;
      cells.forEach(k => occupied.add(k));
      ctx.strokeStyle = '#101c28'; ctx.lineWidth = 3; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
      return true;
    }
    function draw() {
      state.frame = 0; renderer.render(state.scene, camera);
      const ctx = labels.current?.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0, 0, state.w, state.h);
      const p = latest.current, occupied = new Set();
      if (p.mode === '2D' && p.contourStyle?.visible2D && p.contourStyle.labels) {
        ctx.font = '11px Consolas, monospace'; ctx.textBaseline = 'middle'; let count = 0;
        for (const label of state.contourLabels) {
          if (count >= 150) break;
          const q = screen(label.v); if (q.z < -1 || q.z > 1 || q.x < 0 || q.x > state.w || q.y < 0 || q.y > state.h) continue;
          if (drawText(ctx, label.text, q.x - 14, q.y, '#fff1c2', occupied)) count++;
        }
      }
      if (p.mode === '2D' && p.layers.points && p.style.visible) {
        ctx.font = `${p.style.size}px Consolas, monospace`; ctx.textBaseline = 'middle'; let count = 0;
        for (const i of state.visible ?? []) {
          if (count >= 200) break;
          const q = screen(state.positions[i]); if (q.z < -1 || q.z > 1 || q.x < 0 || q.x > state.w || q.y < 0 || q.y > state.h) continue;
          const point = p.points[i], text = [p.style.id ? point.id : '', p.style.elevation ? point.z.toFixed(p.style.precision) : '', p.style.description ? point.description : ''].filter(Boolean).join(' / ');
          if (text && drawText(ctx, text, q.x + 9, q.y, p.style.color, occupied)) count++;
        }
      }
      if (state.pointer) {
        let {x, y} = state.pointer;
        const editor = p.mode === '2D' && PICK_TOOLS.includes(p.tool);
        const snap = editor && p.snap ? nearest(x, y) : null;
        if (snap) { x = snap.x; y = snap.y; }
        if (cursor.current) {
          cursor.current.style.display = p.crosshair && p.mode === '2D' ? 'block' : 'none';
          cursor.current.style.setProperty('--cursor-x', `${x}px`); cursor.current.style.setProperty('--cursor-y', `${y}px`);
          cursor.current.classList.toggle('snapped', !!snap);
        }
        if (readout.current) {
          const point = snap ? p.points[snap.i] : planCoordinate(x, y);
          const z = !snap && point && p.elevationAt ? p.elevationAt(point.x, point.y) : null;
          readout.current.textContent = point ? `${snap ? '● ' + point.id + ' · ' : ''}E ${point.x.toFixed(3)}  N ${point.y.toFixed(3)}${snap ? '  Z ' + point.z.toFixed(3) : z !== null && z !== undefined ? '  Z ' + z.toFixed(3) + ' (TIN)' : ''}` : '';
        }
      }
    }
    const invalidate = () => { if (!state.frame) state.frame = requestAnimationFrame(draw); };
    state.invalidate = invalidate;
    const resize = () => {
      state.w = el.clientWidth; state.h = el.clientHeight; if (!state.w || !state.h) return;
      renderer.setSize(state.w, state.h);
      const ratio = Math.min(devicePixelRatio, 2); labels.current.width = state.w * ratio; labels.current.height = state.h * ratio; labels.current.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
      if (camera.isPerspectiveCamera) { camera.aspect = state.w / state.h; camera.zoom = Math.min(1, camera.aspect) * .9; }
      else { const halfHeight = Math.max((state.extentX || state.span) * state.h / state.w, state.extentY || state.span, 1) * .62; camera.left = -halfHeight * state.w / state.h; camera.right = -camera.left; camera.top = halfHeight; camera.bottom = -camera.top; }
      camera.updateProjectionMatrix(); invalidate();
    };
    state.resize = resize;
    controls.addEventListener('change', invalidate);
    const observer = new ResizeObserver(resize); observer.observe(el);
    const move = e => { const r = el.getBoundingClientRect(); state.pointer = {x: e.clientX - r.left, y: e.clientY - r.top}; invalidate(); };
    const leave = () => { state.pointer = null; if (cursor.current) cursor.current.style.display = 'none'; };
    let down;
    const start = e => { down = {x: e.clientX, y: e.clientY, button: e.button}; };
    const end = e => {
      const p = latest.current;
      if (!down || down.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || p.mode !== '2D') return;
      const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (['breakline', 'boundary'].includes(p.tool)) {
        const near = nearest(x, y, p.snap ? 22 : 6);
        if (near) p.onPoint(near.i); else p.onNotice('Clique em um ponto do levantamento; aproxime a mira para atração.');
      }
      if (p.tool === 'profile') {
        const near = p.snap ? nearest(x, y) : null;
        const at = near ? {x: p.points[near.i].x, y: p.points[near.i].y} : planCoordinate(x, y);
        if (at) p.onPlanPoint(at);
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
      }
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    renderer.domElement.addEventListener('pointerdown', start); renderer.domElement.addEventListener('pointerup', end);
    const lost = e => { e.preventDefault(); setError('Contexto gráfico perdido. Recarregue a página para restaurar.'); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      cancelAnimationFrame(state.frame); observer.disconnect(); controls.dispose();
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave);
      disposeScene(state.scene); renderer.dispose(); renderer.domElement.remove(); runtime.current = null;
    };
  }, []);

  const plan = props.mode === '2D';
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    const {points, triangles, constraints, mode, tool, selected, visibleIndices, layers, presentation, groupColors, boundary, fitKey, contours, contourStyle, alignment, pathDraft, profileSamples, referenceZ} = props;
    disposeScene(r.scene); const scene = new THREE.Scene(); scene.background = new THREE.Color(mode === '2D' ? '#101e2b' : '#172531'); r.scene = scene;
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
    r.controls.enabled = tool === 'orbit' || mode === '3D';
    r.renderer.domElement.style.cursor = mode === '2D' && props.crosshair ? 'none' : 'grab';
    if (mode === '2D' ? layers.grid : presentation.grid) { const grid = new THREE.GridHelper(span * 4, 40, '#345165', '#263c4d'); grid.position.y = mode === '2D' ? -.03 : minZ - cz - span * .04; scene.add(grid); }
    if (triangles.length) {
      const positions = new Float32Array(points.length * 3), colors = new Float32Array(points.length * 3), color = new THREE.Color();
      r.positions.forEach((v, i) => { v.toArray(positions, i * 3); const t = (points[i].z - minZ) / Math.max(maxZ - minZ, .001); hypsometric(t, presentation.style, color); color.toArray(colors, i * 3); });
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(triangles.flat()); geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({color: presentation.style === 'solid' && mode === '3D' ? '#97b5bd' : '#ffffff', vertexColors: presentation.style !== 'solid' || mode === '2D', side: THREE.DoubleSide, roughness: .9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, wireframe: mode === '3D' && presentation.style === 'wire'});
      scene.add(new THREE.Mesh(geometry, material));
    }
    scene.add(new THREE.AmbientLight(0xffffff, 1.4)); const light = new THREE.DirectionalLight(0xfff4df, 2.1); light.position.set(span, span * 2, span * .3); scene.add(light);
    const segments = (vectors, color, opacity = 1, depthTest = false) => {
      if (!vectors.length) return;
      const positions = new Float32Array(vectors.length * 3); vectors.forEach((v, i) => v.toArray(positions, i * 3));
      scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)), new THREE.LineBasicMaterial({color, transparent: opacity < 1, opacity, depthTest})));
    };
    const lines = (pairs, color, opacity = 1) => segments(pairs.flatMap(([a, b]) => [r.positions[a], r.positions[b]]), color, opacity);
    const polyline = (coords, closed = false) => { const out = []; for (let i = 1; i < coords.length; i++) out.push(coords[i - 1], coords[i]); if (closed && coords.length > 2) out.push(coords.at(-1), coords[0]); return out; };
    // Curvas de nível
    r.contourLabels = [];
    if (contours && (mode === '2D' ? contourStyle.visible2D : contourStyle.visible3D)) {
      const minor = [], major = [];
      for (const level of contours.levels) {
        for (const line of level.lines) {
          const vs = line.coords.map(([x, y]) => world(x, y, level.z + lift));
          (level.major ? major : minor).push(...polyline(vs, line.closed));
          if (level.major && mode === '2D' && vs.length > 1) r.contourLabels.push({v: vs[Math.floor(vs.length / 2)], text: level.z.toFixed(level.z % 1 ? 2 : 0)});
        }
      }
      const depth = mode === '3D';
      segments(minor, mode === '2D' ? '#4d7c82' : '#36525a', mode === '2D' ? .75 : .55, depth);
      segments(major, mode === '2D' ? '#163541' : '#203640', mode === '2D' ? 1 : .9, depth);
    }
    if (mode === '2D' && layers.edges) lines(r.edges.map(e => [e.a, e.b]), '#648c94', contourStyle?.visible2D ? .35 : .7);
    if (mode === '2D' && layers.breaklines) lines(constraints, '#ffbd70');
    if (mode === '2D' && layers.border) lines(r.edges.filter(e => e.faces.length === 1).map(e => [e.a, e.b]), '#a9e6ce');
    if (mode === '2D' && boundary.length) lines(boundary.map((i, k) => [i, boundary[(k + 1) % boundary.length]]), '#67c4ff');
    if (mode === '2D' && selected.length > 1) lines(selected.slice(1).map((i, k) => [selected[k], i]), '#ffcf75');
    // Traçado do perfil
    if (mode === '2D') {
      if (alignment.length > 1) segments(polyline(alignment.map(p => world(p.x, p.y))), '#ff7ad9');
      if (pathDraft.length > 1) segments(polyline(pathDraft.map(p => world(p.x, p.y))), '#ffb3ec');
      const marks = [...alignment, ...pathDraft];
      if (marks.length) { const v = new Float32Array(marks.length * 3); marks.forEach((p, k) => world(p.x, p.y).toArray(v, k * 3)); scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(v, 3)), new THREE.PointsMaterial({color: '#ff7ad9', size: 8, sizeAttenuation: false, depthTest: false}))); }
    } else if (profileSamples?.length) {
      const out = []; let prev = null;
      for (const s of profileSamples) { const v = s.z === null ? null : world(s.x, s.y, s.z + lift * 2); if (v && prev) out.push(prev, v); prev = v; }
      segments(out, '#ff5fcf', 1, true);
    }
    // Plano de referência (volumes)
    if (mode === '3D' && Number.isFinite(referenceZ) && presentation.referencePlane) {
      // Plataforma limitada à projeção da TIN: não cobre recortes nem lacunas.
      if (triangles.length) {
        const positions = new Float32Array(points.length * 3);
        points.forEach((p, i) => world(p.x, p.y, referenceZ).toArray(positions, i * 3));
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(triangles.flat());
        scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: '#5db8ff', transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false})));
        segments(r.edges.filter(e => e.faces.length === 1).flatMap(e => [e.a, e.b].map(i => world(points[i].x, points[i].y, referenceZ))), '#8fd0ff', .9, true);
      }
    }
    const makePoints = (indices, size, selectedColor) => {
      if (!indices.length) return;
      const v = new Float32Array(indices.length * 3), colors = new Float32Array(indices.length * 3), color = new THREE.Color();
      indices.forEach((i, k) => { r.positions[i].toArray(v, k * 3); color.set(selectedColor || groupColors[points[i].description.trim() || 'Sem descrição'] || '#d8eee5').toArray(colors, k * 3); });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(v, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      scene.add(new THREE.Points(geo, new THREE.PointsMaterial({size, vertexColors: true, sizeAttenuation: false, depthTest: false})));
    };
    if (mode === '2D' && layers.points) makePoints(visibleIndices, 5);
    if (mode === '2D') makePoints(selected, 9, '#ffbc67');
    r.resize(); r.invalidate();
  }, [props.points, props.triangles, plan ? props.constraints : null, props.mode, plan ? props.selected : null, plan ? props.visibleIndices : null, plan ? props.layers : null, props.presentation,
    plan ? props.groupColors : null, plan ? props.boundary : null, props.fitKey, props.contours, props.contourStyle?.visible2D, props.contourStyle?.visible3D,
    plan ? props.alignment : null, plan ? props.pathDraft : null, plan ? null : props.profileSamples, plan ? null : props.referenceZ]);
  useEffect(() => {
    const r = runtime.current;
    if (r) { r.controls.enabled = props.tool === 'orbit' || props.mode === '3D'; r.renderer.domElement.style.cursor = props.mode === '2D' && props.crosshair ? 'none' : 'grab'; r.invalidate(); }
  }, [props.style, props.crosshair, props.snap, props.tool, props.contourStyle?.labels]);
  return <div className="viewport" ref={host}>
    <canvas className="label-overlay" ref={labels} aria-hidden="true"/>
    <div className="cad-crosshair" ref={cursor} aria-hidden="true"><i className="cross-x"/><i className="cross-y"/><i className="pickbox"/></div>
    <div className="coordinate-readout" ref={readout}/>
    {error && <p className="viewport-error" role="alert">{error}</p>}
  </div>;
}

// Rampa de cores por elevação. "concept" mantém o tom original; "hypso" usa escala hipsométrica.
const HYPSO = [[0, '#2f6f73'], [.25, '#5fa36b'], [.5, '#c9c86a'], [.75, '#c48a4f'], [1, '#efe6dc']].map(([t, c]) => [t, new THREE.Color(c)]);
function hypsometric(t, style, out) {
  if (style !== 'hypso') return out.setHSL(.48 - t * .18, .32, .39 + t * .12);
  for (let i = 1; i < HYPSO.length; i++) if (t <= HYPSO[i][0]) return out.copy(HYPSO[i - 1][1]).lerp(HYPSO[i][1], (t - HYPSO[i - 1][0]) / (HYPSO[i][0] - HYPSO[i - 1][0]));
  return out.copy(HYPSO.at(-1)[1]);
}
function disposeScene(scene) { scene.traverse(o => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } }); scene.clear(); }
