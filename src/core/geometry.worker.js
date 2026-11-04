import {buildSurface,validateProject} from './surface.js';
import {parsePoints} from './parser.js';
self.onmessage=({data})=>{const {id,type,payload}=data;try{
 let result;
 if(type==='import'){const parsed=parsePoints(payload.text,payload.options);result={...parsed,mesh:buildSurface(parsed.points)};}
 else if(type==='project')result=validateProject(payload);
 else result=buildSurface(payload.points,payload.breaklines,payload.boundary,payload.maxEdge);
 self.postMessage({id,result});
 }catch(error){self.postMessage({id,error:error.message});}};
