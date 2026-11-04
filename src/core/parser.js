// Accepted schemas: X Y Z [description], or ID X Y Z [description].
export function parsePoints(text, {schema='auto',mapping=null}={}) {
  const points=[], errors=[], seen=new Map(), ids=new Set();
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
  let columns=null;
  lines.forEach((raw,i)=>{
    const line=raw.trim(); if(!line || /^(#|\/\/)/.test(line)) return;
    const delimiter=line.includes(';')?';':line.includes(',')?',':null;
    const fields=delimiter?line.split(new RegExp(`${delimiter}(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)`)).map(s=>s.trim().replace(/^"|"$/g,'')):line.split(/\s+/);
    const aliases={p:'id',ponto:'id',e:'x',este:'x',n:'y',norte:'y',cota:'z',d:'description',descricao:'description','descrição':'description'};
    const names=fields.map(s=>aliases[s.toLowerCase()]||s.toLowerCase());
    if(names.includes('x')&&names.includes('y')&&names.includes('z')) {columns=names;return;}
    const num=s=>Number(delimiter===';'?s?.replace(',','.'):s);
    const offset=schema==='idxyz'?1:schema==='xyz'?0:fields.length>=4&&!Number.isNaN(num(fields[3]))?1:0;
    const get=k=>mapping?fields[mapping[k]]:columns?fields[columns.indexOf(k)]:fields[{x:offset,y:offset+1,z:offset+2}[k]];
    const coords=['x','y','z'].map(k=>get(k));
    if(coords.some(s=>s===undefined||s==='')||coords.some(s=>!Number.isFinite(num(s)))) {errors.push({line:i+1,message:'Coordenadas inválidas ou ausentes.'});return;}
    const [x,y,z]=coords.map(num), key=`${x}:${y}`;
    if(seen.has(key)) {errors.push({line:i+1,message:`XY duplicado da linha ${seen.get(key)}; ponto ignorado.`});return;}
    const id=String(mapping?fields[mapping.id]??points.length+1:columns?.includes('id')?fields[columns.indexOf('id')]:offset?fields[0]:points.length+1);
    if(!id.trim()){errors.push({line:i+1,message:'Identificador vazio.'});return;}
    if(ids.has(id)){errors.push({line:i+1,message:`Identificador duplicado: ${id}.`});return;}
    const description=mapping?fields[mapping.description]||'':columns?fields[columns.indexOf('description')]||'':fields.slice(offset+3).join(' ');
    points.push({id,x,y,z,description});seen.set(key,i+1);ids.add(id);
  });
  return {points,errors};
}
