import {validateCorridor} from './corridor.js';
import {triangulate,edgesOf} from './tin.js';
import {validateAlignment} from './profile.js';
import {validateGrade} from './grade.js';
import {validatePlatform} from './grading.js';
import {validateDesignLine} from './designLine.js';
export function validatePoints(points){
 if(!Array.isArray(points)||points.length<3)throw Error('São necessários pelo menos três pontos.');
 const ids=new Set(),xy=new Set();
 for(const p of points){if(!p||typeof p.id!=='string'||!p.id.trim()||!['x','y','z'].every(k=>Number.isFinite(p[k]))||typeof p.description!=='string')throw Error('Projeto contém ponto inválido.');const key=`${p.x}:${p.y}`;if(ids.has(p.id)||xy.has(key))throw Error('Projeto contém identificador ou XY duplicado.');ids.add(p.id);xy.add(key);}
}
export function insidePolygon(p,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
 const a=polygon[j],b=polygon[i];
 const cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
 if(Math.abs(cross)<1e-9&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y))return true;
 if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
 }return inside;}
export function validateBoundary(points,boundary){
 if(!Array.isArray(boundary))throw Error('Contorno inválido.');
 if(!boundary.length)return;
 if(boundary.length<3||new Set(boundary).size!==boundary.length||boundary.some(i=>!Number.isInteger(i)||!points[i]))throw Error('O contorno exige pelo menos três vértices diferentes. Não repita o primeiro ponto.');
 const p=boundary.map(i=>points[i]),o=p[0];let area=0;
 for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=(a.x-o.x)*(b.y-o.y)-(b.x-o.x)*(a.y-o.y);}
 if(Math.abs(area)<1e-9)throw Error('Contorno sem área válida.');
 // Reject contacts with nonadjacent sides as well as proper self-intersections.
 const on=(a,b,c)=>Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))<1e-9&&c.x>=Math.min(a.x,b.x)&&c.x<=Math.max(a.x,b.x)&&c.y>=Math.min(a.y,b.y)&&c.y<=Math.max(a.y,b.y);
 for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){if(j===i+1||(i===0&&j===p.length-1))continue;const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];const turn=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)||(turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0))throw Error('O contorno cruza ou toca a si mesmo.');}
}
export function buildSurface(points,breaklines=[],boundary=[],maxEdge=0){
 validatePoints(points);validateBoundary(points,boundary);
 if(!Array.isArray(breaklines)||breaklines.some(p=>!Array.isArray(p)))throw Error('Linhas de ruptura inválidas.');
 if(!Number.isFinite(maxEdge)||maxEdge<0)throw Error('Comprimento máximo inválido.');
 const closed=boundary.length?[...boundary,boundary[0]]:null;
 const mesh=triangulate(points,closed?[...breaklines,closed]:breaklines);
 const polygon=boundary.map(i=>points[i]);const originalCount=mesh.triangles.length;
 mesh.triangles=mesh.triangles.filter(t=>{
 if(maxEdge&&t.some((i,k)=>{const a=points[i],b=points[t[(k+1)%3]];return Math.hypot(a.x-b.x,a.y-b.y)>maxEdge;}))return false;
 if(polygon.length){const p=t.map(i=>points[i]);return insidePolygon({x:p.reduce((s,v)=>s+v.x,0)/3,y:p.reduce((s,v)=>s+v.y,0)/3},polygon);}return true;
 });
 return {...mesh,removed:originalCount-mesh.triangles.length};
}
export function validateProject(data){
 if(!data||![1,2,3,4,5,6,7,8].includes(data.version))throw Error('Versão de projeto não suportada.');
 const points=data.points;validatePoints(points);
 const breaklines=data.breaklines??[],boundary=data.boundary??[],maxEdge=data.maxEdge??0;
 const base=buildSurface(points,breaklines,boundary,maxEdge);
 if(!Array.isArray(data.triangles))throw Error('Projeto sem malha triangular.');
 const seen=new Set();
 for(const t of data.triangles){if(!Array.isArray(t)||t.length!==3||new Set(t).size!==3||t.some(i=>!Number.isInteger(i)||!points[i]))throw Error('Triângulo inválido no projeto.');const key=[...t].sort((a,b)=>a-b).join(':');if(seen.has(key))throw Error('Triângulo duplicado no projeto.');seen.add(key);const [a,b,c]=t.map(i=>points[i]);if(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))<1e-12)throw Error('Triângulo degenerado no projeto.');}
 if(edgesOf(data.triangles).some(e=>e.faces.length>2))throw Error('Malha não manifold.');
 const alignment=validateAlignment(data.alignment??[]);
 const grade=validateGrade(data.grade??[]);
 if(!Array.isArray(data.platforms??[]))throw Error('Plataformas inválidas.');
 const platforms=(data.platforms??[]).map(validatePlatform);
 if(!Array.isArray(data.designLines??[]))throw Error('Linhas de projeto inválidas.');
 const designLines=(data.designLines??[]).map(validateDesignLine);
 const corridor=data.corridor==null?null:validateCorridor(data.corridor);
 return {points,breaklines,boundary,maxEdge,alignment,grade,platforms,designLines,corridor,mesh:{...base,triangles:data.triangles}};
}
