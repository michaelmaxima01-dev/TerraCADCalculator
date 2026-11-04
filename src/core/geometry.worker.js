import {buildSurface,validateProject} from './surface.js';
import {parsePoints} from './parser.js';
import {readCadFile} from './cadReader.js';
self.onmessage=async({data})=>{const {id,type,payload}=data;try{
 let result;
 if(type==='import'){const parsed=parsePoints(payload.text,payload.options);result={...parsed,mesh:buildSurface(parsed.points)};}
 else if(type==='project')result=validateProject(payload);
 else if(type==='cad')result=await readCadFile(payload.bytes,payload.name);
 else result=buildSurface(payload.points,payload.breaklines,payload.boundary,payload.maxEdge);
 self.postMessage({id,result});
 }catch(error){self.postMessage({id,error:error.message});}};
