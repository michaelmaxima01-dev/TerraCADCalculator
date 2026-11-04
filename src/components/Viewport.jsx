import React,{useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {edgesOf} from '../core/tin';
export default function Viewport({points,triangles,constraints,style,mode,tool,onPoint,onEdge,selected,wire,visibleIndices}){
 const host=useRef(),view=useRef(null),[error,setError]=useState('');
 useEffect(()=>{
  let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{setError('WebGL indisponível neste dispositivo.');return;}
  const el=host.current;el.appendChild(renderer.domElement);renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.domElement.style.cursor=tool==='breakline'?'crosshair':'grab';
  const visible=new Set(visibleIndices??points.map((_,i)=>i));
  const scene=new THREE.Scene();scene.background=new THREE.Color('#101c28');
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),zs=points.map(p=>p.z);
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
  const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),1);
  const pos=p=>new THREE.Vector3(p.x-cx,p.z-cz,-(p.y-cy));
  const camera=mode==='2D'?new THREE.OrthographicCamera(-span,span,span,-span,.01,span*30):new THREE.PerspectiveCamera(45,1,.01,span*30);
  camera.position.set(0,span*1.6,mode==='2D'?.00001:span*1.2);camera.lookAt(0,0,0);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableRotate=mode!=='2D';controls.enableDamping=true;
  const viewKey=`${mode}:${cx}:${cy}:${span}`;
  if(view.current?.key===viewKey){camera.position.copy(view.current.position);camera.quaternion.copy(view.current.quaternion);camera.zoom=view.current.zoom;controls.target.copy(view.current.target);camera.updateProjectionMatrix();}
  const grid=new THREE.GridHelper(span*3,30,'#334758','#243441');grid.position.y=Math.min(...zs)-cz-span*.04;scene.add(grid);
  scene.add(new THREE.AmbientLight(0xffffff,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(span,span*2,span);scene.add(light);
  const geo=new THREE.BufferGeometry(),verts=[],colors=[];
  triangles.forEach(t=>t.forEach(i=>{verts.push(...pos(points[i]).toArray());const v=(points[i].z-Math.min(...zs))/Math.max(Math.max(...zs)-Math.min(...zs),1);const c=new THREE.Color().setHSL(.48-v*.16,.35,.28+v*.15);colors.push(c.r,c.g,c.b);}));
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();scene.add(new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.85,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1})));
  const edges=edgesOf(triangles),edgeVerts=[];edges.forEach(e=>edgeVerts.push(...pos(points[e.a]).toArray(),...pos(points[e.b]).toArray()));
  if(wire)scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(edgeVerts,3)),new THREE.LineBasicMaterial({color:'#79a7a2',transparent:true,opacity:.65})));
  constraints.forEach(([a,b])=>scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([pos(points[a]),pos(points[b])]),new THREE.LineBasicMaterial({color:'#ffbc67',depthTest:false}))));
  if(selected.length>1)scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(selected.map(i=>pos(points[i]))),new THREE.LineBasicMaterial({color:'#ffd184',depthTest:false})));
  const snap=new THREE.Mesh(new THREE.SphereGeometry(span*.012,12,12),new THREE.MeshBasicMaterial({color:'#ffbc67',wireframe:true,depthTest:false}));snap.visible=false;scene.add(snap);
  const sprites=[];
  points.forEach((p,i)=>{
   if(!visible.has(i))return;
   const marker=new THREE.Mesh(new THREE.SphereGeometry(span*(selected.includes(i)?.009:.0045),8,8),new THREE.MeshBasicMaterial({color:selected.includes(i)?'#ffbc67':'#d9f3e4'}));marker.position.copy(pos(p));scene.add(marker);
   if(!style.visible)return;
   const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle=style.color;ctx.font=`${style.size*2}px monospace`;
   const label=[style.id?p.id:'',style.elevation?p.z.toFixed(style.precision):'',style.description?p.description:''].filter(Boolean).join(' · ');ctx.fillText(label,8,48);
   const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false,transparent:true}));sprite.position.copy(pos(p)).add(new THREE.Vector3(span*.18,span*.02,0));sprite.scale.set(span*.45,span*.0703125,1);scene.add(sprite);sprites.push(sprite);
  });
  function resize(){const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);if(camera.isPerspectiveCamera)camera.aspect=w/h;else{camera.left=-span*w/h*.8;camera.right=span*w/h*.8;camera.top=span*.8;camera.bottom=-span*.8;}camera.updateProjectionMatrix();}
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  let frame;function animate(){controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(animate);}animate();
  function nearestPoint(e){const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;return points.map((p,i)=>{const v=pos(p).project(camera);return {i,d:visible.has(i)&&v.z>=-1&&v.z<=1?Math.hypot(x-(v.x+1)*rect.width/2,y-(1-v.y)*rect.height/2):Infinity};}).sort((a,b)=>a.d-b.d)[0];}
  const hover=e=>{if(tool!=='breakline')return;const near=nearestPoint(e);snap.visible=near?.d<22;if(snap.visible){snap.position.copy(pos(points[near.i]));renderer.domElement.title=`Atração: ${points[near.i].id}`;}else renderer.domElement.title='Aproxime a mira de um ponto';};
  const leave=()=>snap.visible=false;
  renderer.domElement.addEventListener('pointermove',hover);renderer.domElement.addEventListener('pointerleave',leave);
  let down;const start=e=>down=[e.clientX,e.clientY];
  const click=e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const rect=el.getBoundingClientRect();
    const screen=v=>{const p=v.project(camera);return [(p.x+1)*rect.width/2,(1-p.y)*rect.height/2];};const x=e.clientX-rect.left,y=e.clientY-rect.top;
    if(tool==='breakline'){const near=nearestPoint(e);if(near?.d<22)onPoint(near.i);}
    if(tool==='swap'||tool==='delete'){const near=edges.map(edge=>{const a=screen(pos(points[edge.a])),b=screen(pos(points[edge.b]));const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));return {...edge,d:Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)};}).sort((a,b)=>a.d-b.d)[0];if(near?.d<14)onEdge(near.a,near.b);}
  };renderer.domElement.addEventListener('pointerdown',start);renderer.domElement.addEventListener('pointerup',click);
  return ()=>{view.current={key:viewKey,position:camera.position.clone(),quaternion:camera.quaternion.clone(),zoom:camera.zoom,target:controls.target.clone()};cancelAnimationFrame(frame);observer.disconnect();controls.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});renderer.dispose();renderer.domElement.remove();};
 },[points,triangles,constraints,style,mode,tool,onPoint,onEdge,selected,wire,visibleIndices]);
 return <div className="viewport" ref={host}>{error&&<p role="alert">{error}</p>}</div>;
}
