// Terraplenagem do projeto inteiro: uma única superfície combinada (designSurfaceFunction) integrada contra o
// terreno. Objetos que se sobrepõem não são contados duas vezes; cada objeto continua com o próprio volume.
import {designSurfaceFunction} from './grading.js';
import {compileLine, lineRefine} from './lineGrading.js';
import {corridorElevationAt, corridorBase, corridorRefine} from './corridor.js';
import {gridVolumes} from './slopes.js';

/**
 * @param {Array<{kind:'platform'|'line'|'corridor', platform?, line?, info?, mesh}>} designs objetos calculados (com malha)
 * @returns {{cut, fill, footprint, outside, cells, sum:{cut,fill}, overlap:boolean}} sum = soma simples dos objetos
 */
export function projectEarthworks(designs, {terrainAt, gradeCtx = null, maxCells = 250000, cell, volumes = []} = {}) {
  const list = designs.filter(d => d.mesh && d.mesh.vertices.length);
  if (!list.length) return null;
  const platforms = list.filter(d => d.kind === 'platform').map(d => d.platform), lines = list.filter(d => d.kind === 'line').map(d => d.line);
  const corridors = list.filter(d => d.kind === 'corridor' && d.info?.ok);
  const designAt = designSurfaceFunction(platforms, terrainAt, lines, gradeCtx, corridors.map(d => ({at: (x, y, T) => corridorElevationAt(d.info, x, y, T), base: corridorBase(d.info)})));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of list) for (const v of d.mesh.vertices) { if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x; if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.01;
  const refines = [...lines.map(l => lineRefine(l, compileLine(l, terrainAt, gradeCtx))), ...corridors.map(d => corridorRefine(d.info))];
  const v = gridVolumes(designAt, terrainAt, {minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad}, {cell, maxCells, refine: refines.length ? (x, y, h) => refines.some(f => f(x, y, h)) : null});
  const sum = volumes.filter(Boolean).reduce((s, q) => ({cut: s.cut + q.cut, fill: s.fill + q.fill}), {cut: 0, fill: 0});
  const overlap = volumes.length > 1 && Math.abs(sum.cut + sum.fill - v.cut - v.fill) > Math.max(1, 0.01 * (v.cut + v.fill));
  return {...v, sum, overlap};
}
