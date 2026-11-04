export function pointGroups(points){
 const groups=new Map();
 points.forEach((p,i)=>{const code=p.description.trim()||'Sem descrição';if(!groups.has(code))groups.set(code,[]);groups.get(code).push(i);});
 return [...groups].map(([code,indices])=>({code,indices}));
}
export function upsertPoint(points,draft,index=null){
 const p={id:String(draft.id).trim(),x:Number(draft.x),y:Number(draft.y),z:Number(draft.z),description:String(draft.description||'').trim()};
 if(!p.id||['x','y','z'].some(k=>String(draft[k]).trim()===''||!Number.isFinite(p[k])))throw Error('Informe identificador e coordenadas válidas.');
 if(points.some((q,i)=>i!==index&&q.id===p.id))throw Error('Identificador já utilizado.');
 if(points.some((q,i)=>i!==index&&q.x===p.x&&q.y===p.y))throw Error('Já existe um ponto nessas coordenadas XY.');
 if(index!==null&&(!Number.isInteger(index)||!points[index]))throw Error('Ponto inexistente.');
 const next=points.slice();if(index===null)next.push(p);else next[index]=p;return next;
}
