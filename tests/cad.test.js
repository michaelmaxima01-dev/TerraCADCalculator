import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDXF, decodeDxfBytes} from '../src/core/dxf.js';
import {attrNumber, insertTransform, extractSources, buildCadPoints, decimateLine, separateRegions, suggestSpacing, normalizeLibreDwg, MODEL_CONTAINER} from '../src/core/cad.js';
import {buildSurface} from '../src/core/surface.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const fixture = () => parseDXF(decodeDxfBytes(readFileSync(new URL('./fixtures/blocos.dxf', import.meta.url))));
const byLayer = (sources, layer, kind) => sources.find(s => s.layer === layer && s.kind === kind);

test('attrNumber aceita vírgula decimal e milhar', () => {
  assert.equal(attrNumber('313,361'), 313.361);
  assert.equal(attrNumber(' 12.5 '), 12.5);
  assert.equal(attrNumber('1,234.5'), 1234.5);
  assert.equal(attrNumber('M26'), null);
  assert.equal(attrNumber(''), null);
});

test('insertTransform: base, escala 2 e rotação de 90° levam ao ponto calculado à mão', () => {
  // p − base = (1,0) → escala → (2,0) → rotação 90° → (0,2) → + inserção (10,20)
  const T = insertTransform({x: 10, y: 20, z: 5, sx: 2, sy: 2, sz: 1, rotation: Math.PI / 2}, {x: 1, y: 1, z: 0});
  const p = {x: T.a * 2 + T.b * 1 + T.e, y: T.c * 2 + T.d * 1 + T.f, z: T.sz * 3 + T.tz};
  close(p.x, 10); close(p.y, 22); close(p.z, 8);
});

test('parseDXF lê pontos, blocos com atributos, polilinha 3D, 3DFACE e linha', () => {
  const m = fixture();
  assert.equal(m.format, 'DXF AC1009');
  assert.deepEqual(Object.keys(m.blocks).sort(), ['CONJ', 'SIMB']);
  const ins = m.entities.find(e => e.type === 'insert' && e.name === 'SIMB');
  assert.deepEqual(ins.attrs, {PONTO: 'P7', COTA: '12,25'});
  const conj = m.entities.find(e => e.type === 'insert' && e.name === 'CONJ');
  close(conj.rotation, Math.PI / 2); assert.equal(conj.sx, 2);
  const pl = m.entities.find(e => e.type === 'polyline' && e.layer === 'CURVAS');
  assert.deepEqual(pl.vertices.map(v => v.z), [11, 11, 11]);
  assert.equal(m.entities.filter(e => e.type === 'face').length, 1);
});

test('extractSources: bloco de ponto vira ponto com nº e cota; bloco comum é expandido com transformação', () => {
  const s = extractSources(fixture());
  const pts = byLayer(s, 'PONTOS', 'points');
  assert.equal(pts.container, MODEL_CONTAINER);
  assert.equal(pts.count, 3);
  const p7 = pts.items.find(p => p.id === 'P7');
  assert.deepEqual([p7.x, p7.y, p7.z], [110, 200, 12.25]);
  // CONJ: ponto local (1,2,50), escala 2, rotação 90°, inserção (100,210) → (96,212,50); camada 0 herda PONTOS
  const c = pts.items.find(p => p.z === 50);
  close(c.x, 96); close(c.y, 212);
  assert.ok(pts.defaultOn);
  const planta = byLayer(s, 'PLANTA', 'lines');
  assert.ok(planta.flat); assert.equal(planta.defaultOn, false);
  assert.ok(byLayer(s, 'CURVAS', 'lines').defaultOn);
  assert.equal(byLayer(s, 'CURVAS', 'faces').vertexCount, 4);
  assert.ok(s.indexOf(planta) > s.indexOf(pts), 'fontes sem cota vêm depois');
});

test('extractSources: bloco nunca inserido vira fonte própria, desligada quando o desenho já tem cotas', () => {
  const sym = {base: {x: 0, y: 0, z: 0}, entities: [{type: 'polyline', layer: '0', closed: true, vertices: [{x: -1, y: 0, z: 0}, {x: 1, y: 0, z: 0}]}]};
  const lev = {base: {x: 0, y: 0, z: 0}, entities: [1, 2, 3].map(i => ({type: 'insert', layer: 'LEV', name: 'SIMB', x: i * 10, y: 0, z: 100 + i, sx: 1, sy: 1, sz: 1, rotation: 0, attrs: {PONTO: String(i), DESC: 'M2' + i}}))};
  const model = {entities: [{type: 'point', layer: 'TOPO', x: 0, y: 0, z: 5}], blocks: {SIMB: sym, LEV: lev, '*Paper_Space': {base: {x: 0, y: 0, z: 0}, entities: []}}};
  const s = extractSources(model);
  const b = s.find(x => x.container === 'Bloco LEV');
  assert.equal(b.inserted, false); assert.equal(b.count, 3); assert.equal(b.defaultOn, false);
  assert.deepEqual(b.items.map(p => [p.id, p.z, p.description]), [['1', 101, 'M21'], ['2', 102, 'M22'], ['3', 103, 'M23']]);
  assert.ok(byLayer(s, 'TOPO', 'points').defaultOn);
  assert.ok(!s.some(x => x.container === 'Bloco SIMB'), 'símbolo referenciado não é raiz');
  // sem cotas no desenho, o bloco não inserido passa a vir marcado
  const s2 = extractSources({...model, entities: []});
  assert.ok(s2.find(x => x.container === 'Bloco LEV').defaultOn);
});

test('decimateLine mantém pontas e respeita o espaçamento', () => {
  const line = Array.from({length: 21}, (_, i) => ({x: i * 0.5, y: 0, z: 1}));
  assert.deepEqual(decimateLine(line, 2).map(v => v.x), [0, 2, 4, 6, 8, 10]);
  assert.equal(decimateLine(line, 0).length, 21);
});

test('buildCadPoints: IDs únicos, descrição, duplicados removidos e superfície válida', () => {
  const s = extractSources(fixture()).filter(x => x.defaultOn);
  const {points, stats} = buildCadPoints(s, {spacing: 0});
  assert.equal(new Set(points.map(p => p.id)).size, points.length);
  // polilinha começa em (100,200), mesmo XY do POINT → duplicado; 3DFACE repete o 4º vértice
  assert.equal(stats.duplicates, 2);
  assert.equal(points.length, 3 + 2 + 3);
  assert.equal(points.find(p => p.id === 'P7').description, 'PONTOS');
  assert.ok(points.every(p => /^(P|C|F)\d+$/.test(p.id) || p.id === 'P7'));
  const mesh = buildSurface(points);
  assert.ok(mesh.triangles.length >= 6);
});

test('buildCadPoints: IDs repetidos entre levantamentos ganham sufixo', () => {
  const src = k => ({kind: 'points', layer: 'L', items: [{x: k, y: 0, z: 1, id: '1', description: 'M'}]});
  const {points} = buildCadPoints([src(0), src(5)]);
  assert.deepEqual(points.map(p => p.id), ['1', '1-2']);
});

test('separateRegions detecta levantamentos em lugares distantes', () => {
  const box = (x, y) => ({bbox: {minX: x, minY: y, maxX: x + 100, maxY: y + 100}});
  assert.equal(separateRegions([box(0, 0), box(50, 50)]), null);
  const r = separateRegions([box(0, 0), box(100000, 0)]);
  assert.equal(r.regions, 2); close(r.distance, 100000, 1e-6);
});

test('normalizeLibreDwg converte o banco da LibreDWG (espaço do modelo, blocos, atributos)', () => {
  const db = {tables: {BLOCK_RECORD: {entries: [
    {name: '*Model_Space', basePoint: {x: 0, y: 0, z: 0}, entities: [
      {type: 'POLYLINE3D', layer: 'CN', flag: 0, vertices: [{x: 0, y: 0, z: 5.4}, {x: 1, y: 0, z: 5.4}]},
      {type: 'LWPOLYLINE', layer: 'PL', flag: 512, elevation: 7, vertices: [{x: 0, y: 0}, {x: 1, y: 1}]},
      {type: 'INSERT', layer: 'PT', name: 'SIMB', insertionPoint: {x: 3, y: 4, z: 313.361}, xScale: 1, yScale: 1, zScale: 1, rotation: 0, attribs: [{tag: 'PONTO', text: {text: '1'}}, {tag: 'cota', text: {text: '313,361'}}]},
      {type: 'CIRCLE', layer: 'X', center: {x: 0, y: 0, z: 0}, radius: 1}]},
    {name: 'SIMB', basePoint: {x: 0, y: 0, z: 0}, entities: [{type: 'LINE', layer: '0', startPoint: {x: 0, y: 0, z: 0}, endPoint: {x: 1, y: 0, z: 0}}]}]}}};
  const m = normalizeLibreDwg(db);
  assert.equal(m.entities.length, 3);
  assert.deepEqual(m.entities[1], {type: 'polyline', layer: 'PL', closed: true, vertices: [{x: 0, y: 0, z: 7}, {x: 1, y: 1, z: 7}]});
  assert.deepEqual(m.entities[2].attrs, {PONTO: '1', COTA: '313,361'});
  const s = extractSources(m);
  const p = byLayer(s, 'PT', 'points').items[0];
  assert.deepEqual([p.id, p.x, p.y, p.z], ['1', 3, 4, 313.361]);
  assert.equal(byLayer(s, 'CN', 'lines').zMin, 5.4);
});

test('parseDXF recusa arquivo que não é DXF', () => {
  assert.throws(() => parseDXF('isto não é\num dxf'), /DXF/);
});

test('extractSources marca só a região principal; suggestSpacing limita a quantidade de pontos', () => {
  const line = (x0, n, z) => ({type: 'polyline', layer: 'CN' + x0, closed: false, vertices: Array.from({length: n}, (_, i) => ({x: x0 + i * 0.1, y: 0, z}))});
  const model = {entities: [line(0, 1000, 5), line(1e6, 10, 50)], blocks: {}};
  const s = extractSources(model);
  assert.ok(s.find(x => x.layer === 'CN0').defaultOn);
  assert.equal(s.find(x => x.layer === 'CN1000000').defaultOn, false);
  const main = s.filter(x => x.defaultOn);
  assert.equal(suggestSpacing(main, 2000), 0);
  const sp = suggestSpacing(main, 200);
  assert.ok(buildCadPoints(main, {spacing: sp}).points.length <= 200 && sp > 0);
});
