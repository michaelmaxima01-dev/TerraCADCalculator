// Greide (perfil de projeto): PVIs {station, z, curve} com curvas verticais parabólicas simétricas.
// curve = comprimento L da curva vertical centrada no PVI; é limitado automaticamente para não
// ultrapassar o meio dos trechos vizinhos. PVIs de início e fim não têm curva.

export function validateGrade(grade) {
  if (!Array.isArray(grade)) throw Error('Greide inválido.');
  const out = grade.map(p => {
    if (!p || !Number.isFinite(p.station) || !Number.isFinite(p.z)) throw Error('Greide com PVI inválido.');
    const curve = p.curve === undefined || p.curve === null ? 0 : Number(p.curve);
    if (!Number.isFinite(curve) || curve < 0) throw Error('Comprimento de curva vertical inválido.');
    return {station: p.station, z: p.z, curve};
  });
  for (let i = 1; i < out.length; i++) if (!(out[i].station > out[i - 1].station + 1e-9)) throw Error('As estacas dos PVIs devem ser crescentes e diferentes.');
  return out;
}

export function sortGrade(grade) { return [...grade].sort((a, b) => a.station - b.station); }

/** Geometria do greide: rampas (%) por trecho e curvas efetivas por PVI. */
export function gradeGeometry(grade) {
  const g = validateGrade(grade);
  const slopes = [];
  for (let i = 1; i < g.length; i++) slopes.push((g[i].z - g[i - 1].z) / (g[i].station - g[i - 1].station));
  const curves = g.map((p, i) => {
    if (i === 0 || i === g.length - 1 || p.curve <= 0) return null;
    const half = Math.min(p.curve / 2, (p.station - g[i - 1].station) / 2, (g[i + 1].station - p.station) / 2);
    if (half <= 1e-9) return null;
    const g1 = slopes[i - 1], g2 = slopes[i], A = (g2 - g1) * 100;
    return {index: i, half, length: 2 * half, bvc: p.station - half, evc: p.station + half, g1, g2, A, K: Math.abs(A) > 1e-9 ? 2 * half / Math.abs(A) : Infinity, type: g2 > g1 ? 'côncava' : 'convexa'};
  });
  return {pvis: g, slopes, curves};
}

/** Cota do greide na estaca s (null fora do intervalo do greide). */
export function gradeElevation(geometry, s) {
  const {pvis, slopes, curves} = geometry;
  if (pvis.length < 2 || s < pvis[0].station - 1e-9 || s > pvis.at(-1).station + 1e-9) return null;
  for (const c of curves) {
    if (c && s >= c.bvc && s <= c.evc) {
      const p = pvis[c.index], x = s - c.bvc, zb = p.z - c.g1 * c.half;
      return zb + c.g1 * x + (c.g2 - c.g1) / (4 * c.half) * x * x;
    }
  }
  let i = 1; while (i < pvis.length - 1 && s > pvis[i].station) i++;
  return pvis[i - 1].z + slopes[i - 1] * (s - pvis[i - 1].station);
}

/** Amostras para desenho: inclui PVIs, BVC/EVC e passos internos nas curvas. */
export function sampleGrade(geometry, step = 1) {
  const {pvis, curves} = geometry;
  if (pvis.length < 2) return [];
  const st = new Set(pvis.map(p => p.station));
  for (const c of curves) if (c) { const n = Math.max(8, Math.ceil(c.length / Math.max(step, 1e-6))); for (let k = 0; k <= n; k++) st.add(c.bvc + c.length * k / n); }
  return [...st].sort((a, b) => a - b).map(s => ({station: s, z: gradeElevation(geometry, s)}));
}

/** Insere um PVI respeitando a ordem; retorna o novo greide e o índice inserido. */
export function insertPVI(grade, pvi) {
  const g = sortGrade(grade);
  if (g.some(p => Math.abs(p.station - pvi.station) < 1e-6)) throw Error('Já existe um PVI nessa estaca.');
  const next = sortGrade([...g, {station: pvi.station, z: pvi.z, curve: pvi.curve ?? 0}]);
  return {grade: next, index: next.findIndex(p => p.station === pvi.station)};
}

/** Move um PVI sem ultrapassar os vizinhos (mantém a ordem das estacas). */
export function movePVI(grade, index, station, z, {min = -Infinity, max = Infinity} = {}) {
  const g = grade.map(p => ({...p}));
  const lo = index > 0 ? g[index - 1].station + 1e-3 : min, hi = index < g.length - 1 ? g[index + 1].station - 1e-3 : max;
  g[index].station = Math.min(hi, Math.max(lo, station));
  g[index].z = z;
  return g;
}
