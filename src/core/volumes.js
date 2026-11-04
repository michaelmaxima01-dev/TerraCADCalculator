// Estatísticas da superfície e volumes de corte/aterro em relação a um plano horizontal.
// O integral é exato para a TIN (z linear em cada triângulo): cada triângulo é recortado
// pela linha z = referência e cada parte é integrada pela fórmula do centróide.

const area2 = (a, b, c) => ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;

export function surfaceStats(points, triangles) {
  let area2D = 0, area3D = 0, minZ = Infinity, maxZ = -Infinity;
  const used = new Set();
  for (const t of triangles) {
    const [a, b, c] = t.map(i => points[i]);
    area2D += Math.abs(area2(a, b, c));
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    area3D += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    t.forEach(i => used.add(i));
  }
  for (const i of used) { const z = points[i].z; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  return {area2D, area3D, minZ: used.size ? minZ : null, maxZ: used.size ? maxZ : null, triangles: triangles.length, vertices: used.size};
}

// Integral de f linear sobre polígono convexo (lista de {x,y,f}) por leque de triângulos.
function integrate(poly) {
  let sum = 0, area = 0;
  for (let i = 1; i + 1 < poly.length; i++) {
    const a = poly[0], b = poly[i], c = poly[i + 1], A = Math.abs(area2(a, b, c));
    sum += A * (a.f + b.f + c.f) / 3; area += A;
  }
  return {sum, area};
}

/**
 * Corte = volume do terreno acima da referência (material a remover até a cota).
 * Aterro = volume vazio abaixo da referência (material a acrescentar até a cota).
 */
export function volumeToPlane(points, triangles, referenceZ) {
  if (!Number.isFinite(referenceZ)) throw Error('Informe uma cota de referência válida.');
  let cut = 0, fill = 0, areaCut = 0, areaFill = 0;
  for (const t of triangles) {
    const v = t.map(i => ({x: points[i].x, y: points[i].y, f: points[i].z - referenceZ}));
    const above = [], below = [];
    for (let k = 0; k < 3; k++) {
      const p = v[k], q = v[(k + 1) % 3];
      if (p.f >= 0) above.push(p);
      if (p.f <= 0) below.push(p); // vértice na cota pertence às duas partes
      if ((p.f > 0 && q.f < 0) || (p.f < 0 && q.f > 0)) {
        const s = p.f / (p.f - q.f), m = {x: p.x + s * (q.x - p.x), y: p.y + s * (q.y - p.y), f: 0};
        above.push(m); below.push(m);
      }
    }
    if (above.length >= 3) { const r = integrate(above); cut += r.sum; if (r.sum > 0) areaCut += r.area; }
    if (below.length >= 3) { const r = integrate(below); fill -= r.sum; if (r.sum < 0) areaFill += r.area; }
  }
  return {referenceZ, cut, fill, net: cut - fill, areaCut, areaFill};
}

/** Cota de equilíbrio (corte ≈ aterro) por bisseção. Útil para sugerir plataforma. */
export function balanceElevation(points, triangles, tolerance = 1e-4) {
  const s = surfaceStats(points, triangles);
  if (!triangles.length) return null;
  let lo = s.minZ, hi = s.maxZ;
  for (let i = 0; i < 80 && hi - lo > tolerance; i++) {
    const mid = (lo + hi) / 2, r = volumeToPlane(points, triangles, mid);
    if (r.net > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
