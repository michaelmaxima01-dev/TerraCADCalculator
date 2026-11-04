import cdt2d from 'cdt2d';
export const edgeKey=(a,b)=>[a,b].sort((a,b)=>a-b).join(':');
const orient=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const crosses=(a,b,c,d)=>orient(a,b,c)*orient(a,b,d)<0&&orient(c,d,a)*orient(c,d,b)<0;
export function edgesOf(triangles){const edges=new Map();triangles.forEach((t,i)=>t.forEach((a,j)=>{const b=t[(j+1)%3],key=edgeKey(a,b);if(!edges.has(key))edges.set(key,{a:Math.min(a,b),b:Math.max(a,b),faces:[]});edges.get(key).faces.push(i);}));return [...edges.values()];}
export function constraintsFor(points, polylines){
  const edges=new Map();
  for(const poly of polylines){
    if(poly.length<2)throw Error('Uma breakline exige pelo menos dois pontos.');
    for(let i=1;i<poly.length;i++){
      const a=poly[i-1],b=poly[i];
      if(!Number.isInteger(a)||!Number.isInteger(b)||!points[a]||!points[b]||a===b)throw Error('Índices de breakline inválidos.');
      const p=points[a],q=points[b],len=(q.x-p.x)**2+(q.y-p.y)**2;
      const on=points.map((r,j)=>({j,t:((r.x-p.x)*(q.x-p.x)+(r.y-p.y)*(q.y-p.y))/len,r})).filter(v=>v.t>=0&&v.t<=1&&Math.abs(orient(p,q,v.r))<=1e-10*len).sort((u,v)=>u.t-v.t);
      for(let k=1;k<on.length;k++){const u=on[k-1].j,v=on[k].j;edges.set(edgeKey(u,v),[u,v]);}
    }
  }
  const list=[...edges.values()];
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const [a,b]=list[i],[c,d]=list[j];if(crosses(points[a],points[b],points[c],points[d]))throw Error('Breaklines se cruzam sem vértice comum. Insira um ponto na interseção.');}
  return list;
}
export function triangulate(points,polylines=[]){
  if(points.length<3)throw Error('Importe pelo menos três pontos.');
  const constraints=constraintsFor(points,polylines);
  const origin=points[0];
  const triangles=cdt2d(points.map(p=>[p.x-origin.x,p.y-origin.y]),constraints,{delaunay:true});
  if(!triangles.length)throw Error('Os pontos são colineares: não formam uma superfície.');
  return {triangles,constraints};
}
export function editEdge(points,triangles,constraints,a,b,operation){
  if(constraints.some(e=>edgeKey(...e)===edgeKey(a,b)))throw Error('Aresta de breakline protegida.');
  const edge=edgesOf(triangles).find(e=>edgeKey(e.a,e.b)===edgeKey(a,b));
  if(!edge)throw Error('Aresta inexistente.');
  const next=triangles.filter((_,i)=>!edge.faces.includes(i));
  // A TIN is triangular. Delete Line removes incident faces, leaving a hole.
  if(operation==='delete')return next;
  if(operation!=='swap')throw Error('Operação desconhecida.');
  if(edge.faces.length!==2)throw Error('Swap exige uma aresta interna.');
  const [c,d]=edge.faces.map(i=>triangles[i].find(v=>v!==a&&v!==b));
  if(!crosses(points[a],points[b],points[c],points[d]))throw Error('Quadrilátero não convexo: swap inválido.');
  const original=triangles[edge.faces[0]];
  const sign=Math.sign(orient(...original.map(i=>points[i])));
  const orientFace=t=>Math.sign(orient(...t.map(i=>points[i])))===sign?t:[t[0],t[2],t[1]];
  return [...next,orientFace([c,d,a]),orientFace([d,c,b])];
}
