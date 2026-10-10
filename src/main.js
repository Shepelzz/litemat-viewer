import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import {PROG,step} from './progress.js';
import {readLitematic} from './litematic.js';
import {M,setModel,convert,at,hash} from './convert.js';
import {greedyMesh} from './greedy.js';
import * as hist from './history.js';

// ===== Rendering: toon shading + ink outlines =====
const view=document.getElementById('view');
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=false; // redrawn only when its frustum or the geometry changes (fitShadow / sync)
view.appendChild(renderer.domElement);
const BG=new THREE.Color('#f3ede0');
const scene=new THREE.Scene(); scene.background=BG;
const camera=new THREE.OrthographicCamera(-1,1,1,-1,1,600);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.maxPolarAngle=Math.PI*0.48; controls.minZoom=0.5; controls.maxZoom=6;
// mouse/trackpad: drag (left button / trackpad click) moves the map, right button / two-finger click rotates.
// touch screens keep the OrbitControls default: one finger rotates, two fingers pinch-zoom and pan
controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
controls.rotateSpeed=0.5; controls.dampingFactor=0.2; // half-screen drag ≈ 90°, short inertia
// render on demand: nothing is drawn while the view is still
let dirty=true;const invalidate=()=>{dirty=true;};
controls.addEventListener('change',invalidate);
// wheel zoom: proportional to how far you scroll (trackpads send dozens of small events per gesture), pinch
// (ctrlKey) a bit stronger, and anchored at the cursor like a map. Touch pinch is still handled by OrbitControls.
renderer.domElement.addEventListener('wheel',e=>{
  e.preventDefault();e.stopImmediatePropagation();
  const dy=e.deltaY*(e.deltaMode===1?33:e.deltaMode===2?400:1);
  const f=Math.exp(-THREE.MathUtils.clamp(dy*(e.ctrlKey?0.01:0.0015),-0.5,0.5));
  const z=THREE.MathUtils.clamp(camera.zoom*f,controls.minZoom,controls.maxZoom);if(z===camera.zoom)return;
  const r=renderer.domElement.getBoundingClientRect(),n=new THREE.Vector3((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1,0);
  const p0=n.clone().unproject(camera);camera.zoom=z;camera.updateProjectionMatrix();
  const d=p0.sub(n.unproject(camera));camera.position.add(d);controls.target.add(d);
  controls.update();invalidate();
},{passive:false,capture:true});
// orbit around what you're looking at: on each gesture, slide the pivot along the view axis onto the
// first solid block (ortho camera, so the picture doesn't move), instead of spinning around the model's middle
controls.addEventListener('start',()=>{const p=surfaceAtCenter();if(!p)return;const d=p.sub(controls.target);controls.target.add(d);camera.position.add(d);});
scene.add(new THREE.AmbientLight(0xfff4e6,0.66));
const sun=new THREE.DirectionalLight(0xfff3e0,0.36);
sun.castShadow=true; sun.shadow.mapSize.set(2048,2048);
sun.shadow.bias=-0.0008; sun.shadow.normalBias=0.05;
scene.add(sun,sun.target);
const grad=new THREE.DataTexture(new Uint8Array([120,120,120,255, 200,200,200,255, 255,255,255,255]),3,1,THREE.RGBAFormat);
grad.minFilter=grad.magFilter=THREE.NearestFilter; grad.needsUpdate=true;
const toon=o=>new THREE.MeshToonMaterial(Object.assign({gradientMap:grad},o));

const styled=new THREE.Group(), cubes=new THREE.Group();
scene.add(styled,cubes);
let disc=null, loaded=false;
function frameModel(){
  const H=M.NY-M.CUT, R=Math.hypot(M.NX,M.NZ)/2+4;
  styled.position.set(-M.NX/2,-M.CUT,-M.NZ/2); cubes.position.copy(styled.position);
  if(disc){scene.remove(disc);disc.geometry.dispose();}
  disc=new THREE.Mesh(new THREE.CylinderGeometry(R,R,0.4,96),toon({color:'#efe6d2'}));disc.position.y=-0.2;disc.receiveShadow=true;scene.add(disc);
  const S=Math.max(R,H);
  SHADOW.H=H;SHADOW.S=S;
  // big builds get a denser shadow map on desktops; the shadow frustum itself follows the view (fitShadow)
  const ms=(S>64&&finePointer.matches&&renderer.capabilities.maxTextureSize>=8192)?4096:2048;
  if(sun.shadow.mapSize.x!==ms){sun.shadow.mapSize.set(ms,ms);sun.shadow.map?.dispose();sun.shadow.map=null;}
  controls.target.set(0,H*0.42,0);
  VIEW.ext=viewExtents(H,R,H*0.42);
  camera.zoom=1;post.uniforms.depthScale.value=S*12+99;camera.position.set(VIEW.dir[0]*S*5,VIEW.dir[1]*S*5+H*0.42,VIEW.dir[2]*S*5);camera.far=S*12+100;
  resize();
}
function inst(geo,mat,items,fn){const im=new THREE.InstancedMesh(geo,mat,Math.max(items.length,1));im.count=items.length;
  items.forEach((it,i)=>{const [m,c]=fn(it);im.setMatrixAt(i,m);if(c)im.setColorAt(i,c);});im.castShadow=im.receiveShadow=true;return im;}
// voxel ray march (Amanatides–Woo) along the view axis; returns the world-space hit point or null
function surfaceAtCenter(){
  if(!loaded)return null;
  // along the camera axis (the frustum is off-centre around header/panel, so this is the point orbiting keeps still)
  const o=camera.position.clone(),d=new THREE.Vector3();camera.getWorldDirection(d);
  o.sub(styled.position); // into grid space: block (x,y,z) spans [x,x+1]
  const N=[M.NX,M.NY,M.NZ],O=[o.x,o.y,o.z],D=[d.x,d.y,d.z];
  // enter the grid box
  let t0=0,t1=Infinity;
  for(let a=0;a<3;a++){if(Math.abs(D[a])<1e-9){if(O[a]<0||O[a]>N[a])return null;continue;}
    let ta=(0-O[a])/D[a],tb=(N[a]-O[a])/D[a];if(ta>tb)[ta,tb]=[tb,ta];t0=Math.max(t0,ta);t1=Math.min(t1,tb);}
  if(t0>t1)return null;
  const P=O.map((v,a)=>v+D[a]*(t0+1e-4)),c=P.map((v,a)=>Math.min(N[a]-1,Math.max(0,Math.floor(v))));
  const step=D.map(v=>v>0?1:-1),tMax=[0,0,0],tD=[0,0,0];
  for(let a=0;a<3;a++){tD[a]=Math.abs(1/D[a]);const edge=c[a]+(D[a]>0?1:0);tMax[a]=t0+(Math.abs(D[a])<1e-9?Infinity:(edge-P[a])/D[a]);}
  let t=t0;
  for(let i=0;i<4096;i++){
    const g=M.GRID[c[0]+M.NX*(c[1]+M.NY*c[2])];
    if(g&&M.KIND[g]!=='skip')return new THREE.Vector3(O[0]+D[0]*t,O[1]+D[1]*t,O[2]+D[2]*t).add(styled.position);
    const a=tMax[0]<tMax[1]?(tMax[0]<tMax[2]?0:2):(tMax[1]<tMax[2]?1:2);
    t=tMax[a];c[a]+=step[a];if(c[a]<0||c[a]>=N[a])return null;tMax[a]+=tD[a];
  }
  return null;
}
// ===== Chunks: split geometry into CH×CH columns so off-screen parts are culled (main, outline and shadow passes) =====
const CH=32;
const chunkKey=(x,z)=>Math.floor(x/CH)+','+Math.floor(z/CH);
// non-indexed geometry → one geometry per chunk, by triangle centroid
function splitGeometry(g){
  const P=g.attributes.position.array,names=Object.keys(g.attributes),n=P.length/9,buckets=new Map();
  for(let t=0;t<n;t++){const o=t*9,k=chunkKey((P[o]+P[o+3]+P[o+6])/3,(P[o+2]+P[o+5]+P[o+8])/3);
    let b=buckets.get(k);if(!b)buckets.set(k,b=[]);b.push(t);}
  const out=[];
  for(const tris of buckets.values()){
    const ng=new THREE.BufferGeometry();
    for(const a of names){const src=g.attributes[a].array,dst=new Float32Array(tris.length*9);
      for(let i=0;i<tris.length;i++)dst.set(src.subarray(tris[i]*9,tris[i]*9+9),i*9);
      ng.setAttribute(a,new THREE.BufferAttribute(dst,3));}
    ng.computeBoundingSphere();out.push(ng);
  }
  g.dispose();return out;
}
function addChunked(group,g,mat){for(const cg of splitGeometry(g)){const m=new THREE.Mesh(cg,mat);m.castShadow=m.receiveShadow=true;group.add(m);}}
// instanced items (pos at it.p or matrix it.m) → one InstancedMesh per chunk with a bounding sphere around its instances
function addInstChunked(group,geo,mat,items,fn,posOf){
  const buckets=new Map();
  for(const it of items){const p=posOf(it),k=chunkKey(p.x,p.z);let b=buckets.get(k);if(!b)buckets.set(k,b=[]);b.push(it);}
  const box=new THREE.Box3(),v=new THREE.Vector3();
  for(const list of buckets.values()){
    const cg=geo.clone();box.makeEmpty();for(const it of list)box.expandByPoint(v.copy(posOf(it)));
    cg.boundingSphere=box.getBoundingSphere(new THREE.Sphere());cg.boundingSphere.radius+=2;
    const im=inst(cg,mat,list,fn);im.frustumCulled=true; // three r147 turns culling off for InstancedMesh; our sphere covers the chunk
    group.add(im);
  }
  geo.dispose();
}
let triCount=0, rawDirty=true;
async function buildRaw(){ // 'as in game' view, built on demand
  if(!rawDirty)return; rawDirty=false; clear(cubes);
  const solid=new Uint8Array(M.PAL.length);for(let i=0;i<M.PAL.length;i++)solid[i]=M.KIND[i]==='skip'?0:1;
  const ct=M.PAL.map(e=>new THREE.Color(e.t)),cs=M.PAL.map(e=>new THREE.Color(e.s));
  const g=await greedyMesh(solid,solid,ct,cs,0,1,'Готовлю вид «как в игре»');
  addChunked(cubes,g,new THREE.MeshLambertMaterial({vertexColors:true}));
}
function clear(g){for(const ch=[...g.children];ch.length;){const o=ch.pop();g.remove(o);o.geometry.dispose();}}
let buildId=0;
async function rebuild(p0=0,p1=1){
  if(!loaded)return;
  const my=++buildId;
  clear(styled);clear(cubes);styled.position.y=cubes.position.y=-M.CUT;
  const s=await convert(p0,p0+(p1-p0)*0.8);
  if(my!==buildId)return false;
  await step(p0+(p1-p0)*0.82,'Собираю сцену',true);
  const toonMat=toon({vertexColors:true});
  if(s.tri.pos.length){const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(s.tri.pos,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(s.tri.col,3));
    g.computeVertexNormals();
    addChunked(styled,g,toonMat);}
  const solidT=new Uint8Array(M.PAL.length),occT=new Uint8Array(M.PAL.length);
  for(let i=0;i<M.PAL.length;i++){solidT[i]=occT[i]=M.KIND[i]==='cube'?1:0;}
  const gg=await greedyMesh(solidT,occT,M.COLT,M.COLS,p0+(p1-p0)*0.82,p0+(p1-p0)*0.95,'Склеиваю грани');
  if(my!==buildId)return false;
  const ggTris=gg.attributes.position.count/3;
  addChunked(styled,gg,toonMat);
  await step(p0+(p1-p0)*0.96,'Собираю сцену',true);
  const _t=new THREE.Vector3();
  if(s.boxes.length)addInstChunked(styled,new THREE.BoxGeometry(1,1,1),toon({color:0xffffff}),s.boxes,o=>[o.m,o.c],o=>_t.setFromMatrixPosition(o.m));
  // level of detail for foliage on big maps
  let blobs=s.blobs, det=2;
  if(blobs.length>60000){blobs=blobs.filter(o=>hash(o.p.x|0,o.p.y|0,o.p.z|0)<0.5);for(const o of blobs)o.r*=1.22;}
  det=blobs.length>40000?0:blobs.length>12000?1:2;
  const blob=new THREE.IcosahedronGeometry(1,det);
  // sphere normals on every detail level: low-poly blobs otherwise get flat facets, which the outline pass inks as edges
  {const P=blob.attributes.position,N=blob.attributes.normal,v=new THREE.Vector3();for(let i=0;i<P.count;i++){v.fromBufferAttribute(P,i).normalize();N.setXYZ(i,v.x,v.y,v.z);}N.needsUpdate=true;}
  const blobTris=blob.attributes.position.count/3;
  if(blobs.length)addInstChunked(styled,blob,toon({color:0xffffff}),blobs,o=>[new THREE.Matrix4().compose(o.p,new THREE.Quaternion(),new THREE.Vector3(o.r,o.r*.9,o.r)),o.c],o=>o.p);
  triCount=s.tri.pos.length/9+ggTris+s.boxes.length*12+blobs.length*blobTris;
  rawDirty=true; if(st.mode==='cube') await buildRaw();
  sync();
}

const rtColor=new THREE.WebGLRenderTarget(1,1,{samples:4});
const rtNormal=new THREE.WebGLRenderTarget(1,1); rtNormal.depthTexture=new THREE.DepthTexture(1,1);
const normalMat=new THREE.MeshNormalMaterial();
const post=new THREE.ShaderMaterial({
  uniforms:{tColor:{value:rtColor.texture},tNormal:{value:rtNormal.texture},tDepth:{value:rtNormal.depthTexture},
    res:{value:new THREE.Vector2(1,1)},px:{value:1},depthScale:{value:599},ink:{value:new THREE.Color('#4a3a30')},lines:{value:1},dThr:{value:.55},lw:{value:1},ia:{value:1}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`
    uniform sampler2D tColor,tNormal,tDepth;uniform vec2 res;uniform float px,depthScale,lines,dThr,lw,ia;uniform vec3 ink;varying vec2 vUv;
    float D(vec2 uv){return texture2D(tDepth,uv).x*depthScale;}
    vec3 N(vec2 uv){return texture2D(tNormal,uv).xyz*2.-1.;}
    float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){
      vec3 c=texture2D(tColor,vUv).rgb; vec2 p=vUv*res;
      vec2 wob=vec2(sin(p.y*0.045+sin(p.x*0.013)*2.),cos(p.x*0.05+sin(p.y*0.011)*2.))*0.35*lw/res;
      vec2 uv=vUv+wob, o=lw/res;
      // second difference: 0 on any flat surface however steeply it's viewed (a first difference grows at grazing
      // angles and flickers per triangle near the threshold, e.g. stripes across the plinth's fan triangles)
      float d0=2.*D(uv);
      float d=abs(D(uv+vec2(o.x,0))+D(uv-vec2(o.x,0))-d0)+abs(D(uv+vec2(0,o.y))+D(uv-vec2(0,o.y))-d0);
      float n=length(N(uv+vec2(o.x,0))-N(uv-vec2(o.x,0)))+length(N(uv+vec2(0,o.y))-N(uv-vec2(0,o.y)));
      float e=max(smoothstep(dThr,dThr*1.6,d),smoothstep(0.5,0.9,n))*lines;
      c=mix(c,ink,clamp(e,0.,1.)*0.92*ia);
      c*=0.99+0.01*h(floor(p/1.5));
      gl_FragColor=vec4(c,1.);
    }`});
const postScene=new THREE.Scene(); postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),post)); const postCam=new THREE.Camera();

const $=id=>document.getElementById(id);
const st={mode:'toon'};
function sync(){
  invalidate();renderer.shadowMap.needsUpdate=true;
  $('mCube').setAttribute('aria-pressed',st.mode==='cube');$('mToon').setAttribute('aria-pressed',st.mode==='toon');
  styled.visible=st.mode==='toon';cubes.visible=st.mode==='cube';$('panel').classList.toggle('off',st.mode==='cube');
  post.uniforms.lines.value=$('lines').checked?1:0; sun.castShadow=$('shadows').checked;
  $('stats').textContent=!loaded?'':st.mode==='cube'?'Исходные блоки, как в игре':`~${Math.round(triCount).toLocaleString('ru')} треугольников`;
}
$('mCube').onclick=async()=>{st.mode='cube';if(rawDirty){startProgress('');try{await buildRaw();}finally{stopProgress();}}sync();};$('mToon').onclick=()=>{st.mode='toon';sync();};
$('lines').addEventListener('input',sync);
$('shadows').addEventListener('input',sync);
const VIEW={dir:[-0.55,0.62,0.56],fh:40};
camera.position.set(VIEW.dir[0]*200,VIEW.dir[1]*200,VIEW.dir[2]*200);
// model + plinth extents in screen-plane units (u right, v up), relative to the orbit target
function viewExtents(H,R,ty){
  const d=new THREE.Vector3(...VIEW.dir).normalize(),f=d.clone().negate();
  const r=new THREE.Vector3().crossVectors(f,new THREE.Vector3(0,1,0)).normalize(),up=new THREE.Vector3().crossVectors(r,f);
  const e={u0:1e9,u1:-1e9,v0:1e9,v1:-1e9},p=new THREE.Vector3();
  const add=(x,y,z)=>{p.set(x,y-ty,z);const u=p.dot(r),v=p.dot(up);e.u0=Math.min(e.u0,u);e.u1=Math.max(e.u1,u);e.v0=Math.min(e.v0,v);e.v1=Math.max(e.v1,v);};
  for(const x of[-M.NX/2,M.NX/2])for(const y of[0,H])for(const z of[-M.NZ/2,M.NZ/2])add(x,y,z);
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2;add(Math.cos(a)*R,0,Math.sin(a)*R);}
  return e;
}
// fit the model into the screen area not covered by the header (top) and the settings panel (left / bottom)
function resize(){
  invalidate();
  const w=view.clientWidth,h=view.clientHeight,e=VIEW.ext;
  // each frame is 3 full-screen passes; keep the render under ~5 MP so big Retina windows stay fill-rate friendly
  renderer.setPixelRatio(Math.max(1,Math.min(devicePixelRatio,2,Math.sqrt(5e6/Math.max(1,w*h)))));
  if(e){
    const hdr=document.querySelector('.top')?.getBoundingClientRect().bottom||0;
    const open=!(w<=560&&$('panel').classList.contains('collapsed'));
    const T=hdr+12,B=open&&w>860?24:72,L=open&&w>860?322:16,Rm=16;
    const aw=Math.max(50,w-L-Rm),ah=Math.max(50,h-T-B);
    const k=Math.max((e.u1-e.u0)/aw,(e.v1-e.v0)/ah)*1.04;
    VIEW.area={x:L,y:T,w:aw,h:ah};
    const uL=(e.u0+e.u1)/2-(L+aw/2)*k,vT=(e.v0+e.v1)/2+(T+ah/2)*k;
    camera.left=uL;camera.right=uL+w*k;camera.top=vT;camera.bottom=vT-h*k;
    // let any model be zoomed in to ~48 CSS px per block (small ones keep the old 6× limit)
    controls.maxZoom=Math.max(6,48*k);
  }else{const a=w/h,fh=VIEW.fh;camera.left=-fh*a/2;camera.right=fh*a/2;camera.top=fh/2;camera.bottom=-fh/2;}
  camera.updateProjectionMatrix();
  renderer.setSize(w,h,false);
  const dw=Math.floor(w*renderer.getPixelRatio()),dh=Math.floor(h*renderer.getPixelRatio());
  rtColor.setSize(dw,dh);rtNormal.setSize(dw,dh);post.uniforms.res.value.set(dw,dh);post.uniforms.px.value=renderer.getPixelRatio();
}
addEventListener('resize',resize);resize();
async function loadModel(m,label){
  setModel(m); M.CUT=0; loaded=true; // always show the full schematic, ground included
  $('title').textContent=m.name||label||'Схематика';
  $('meta').textContent=[m.author&&('автор: '+m.author),`${M.NX}×${M.NY}×${M.NZ}`].filter(Boolean).join(', ');
  await rebuild(0.42,0.97); frameModel();
  await step(0.99,'Рисую',true);
  document.body.classList.add('has-model');
}
// ===== Shadow frustum follows the view =====
// One map stretched over a 400-block build leaves ~3 texels per block. Instead, cover only what is on screen:
// the 4 screen-corner rays, clipped to the model's box, projected into light space; snapped to texels to avoid shimmer.
const SHADOW={H:1,S:1};
const SUN_DIR=new THREE.Vector3(-0.45,0.8,0.55).normalize();
const L_F=SUN_DIR.clone().negate(),L_R=new THREE.Vector3().crossVectors(L_F,new THREE.Vector3(0,1,0)).normalize(),L_U=new THREE.Vector3().crossVectors(L_R,L_F);
const _o=new THREE.Vector3(),_d=new THREE.Vector3(),_p=new THREE.Vector3(),_c=new THREE.Vector3();
let shHalf=0,shKey='';
function fitShadow(){
  const bx=M.NX/2+1,bz=M.NZ/2+1,H=SHADOW.H+1,S=SHADOW.S;
  camera.getWorldDirection(_d);
  let u0=1e9,u1=-1e9,v0=1e9,v1=-1e9,w0=1e9,w1=-1e9,hit=0;
  const add=p=>{const u=p.dot(L_R),v=p.dot(L_U),w=p.dot(L_F);u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v);w0=Math.min(w0,w);w1=Math.max(w1,w);hit++;};
  // model box corners that are on screen (covers the zoomed-out case where screen corners miss the model)
  for(const x of[-bx,bx])for(const y of[-1,H])for(const z of[-bz,bz]){_p.set(x,y,z);const n=_p.clone().project(camera);if(Math.abs(n.x)<=1&&Math.abs(n.y)<=1)add(_p);}
  for(const sx of[-1,0,1])for(const sy of[-1,0,1]){
    _o.set(sx,sy,-1).unproject(camera);
    // slab-clip the ray against the model box (y from -1 to H, x/z from -b to b)
    let t0=-1e9,t1=1e9;
    for(const [o,d,lo,hi] of [[_o.x,_d.x,-bx,bx],[_o.y,_d.y,-1,H],[_o.z,_d.z,-bz,bz]]){
      if(Math.abs(d)<1e-9){if(o<lo||o>hi){t0=1;t1=0;}continue;}
      let a=(lo-o)/d,b=(hi-o)/d;if(a>b)[a,b]=[b,a];t0=Math.max(t0,a);t1=Math.min(t1,b);
    }
    if(t0<=t1){add(_p.copy(_d).multiplyScalar(t0).add(_o));add(_p.copy(_d).multiplyScalar(t1).add(_o));}
  }
  let half;
  if(hit<2){half=S+6;u0=u1=v0=v1=0;} // nothing of the model on screen: fall back to the whole thing
  else half=Math.min(S+6,Math.max(u1-u0,v1-v0)/2+3);
  // only change the size in coarse steps, so zooming doesn't make shadows crawl every frame
  const q=Math.pow(2,Math.ceil(Math.log2(half)*4)/4);
  if(Math.abs(q-shHalf)>1e-6){shHalf=q;Object.assign(sun.shadow.camera,{left:-q,right:q,top:q,bottom:-q});}
  const texel=2*shHalf/sun.shadow.mapSize.x;
  const cu=Math.round((u0+u1)/2/texel)*texel,cv=Math.round((v0+v1)/2/texel)*texel;
  const D=S*4+60, cw=Math.round((hit<2?0:(w0+w1)/2)/8)*8;
  const key=shHalf+'|'+cu+'|'+cv+'|'+cw+'|'+D;
  if(key===shKey)return; shKey=key; renderer.shadowMap.needsUpdate=true;
  _c.set(0,0,0).addScaledVector(L_R,cu).addScaledVector(L_U,cv).addScaledVector(L_F,cw);
  sun.target.position.copy(_c);sun.position.copy(_c).addScaledVector(SUN_DIR,D);
  sun.shadow.camera.near=1;sun.shadow.camera.far=D*2;sun.shadow.camera.updateProjectionMatrix();
}
(function loop(){
  requestAnimationFrame(loop);
  if(document.body.classList.contains('loading'))return; // don't spend the frame budget on rendering while we build
  if(controls.update())dirty=true;
  if(!dirty)return;dirty=false;
  if(loaded&&sun.castShadow)fitShadow();
  draw();
})();
function draw(){
  { // line weight follows on-screen block size: thin & faint when blocks are tiny, a bit bolder up close
    const pr=renderer.getPixelRatio(), hpx=view.clientHeight||1;
    const ppb=hpx*camera.zoom/(camera.top-camera.bottom);   // CSS pixels per block
    post.uniforms.lw.value=pr*THREE.MathUtils.clamp(Math.pow(ppb/14,0.85),0.4,1.6);
    post.uniforms.ia.value=THREE.MathUtils.clamp((ppb-2.5)/8,0.12,1);
    post.uniforms.dThr.value=Math.max(0.55,5/ppb*post.uniforms.lw.value/pr); }
  if(st.mode==='cube'){renderer.setRenderTarget(null);renderer.render(scene,camera);return;}
  renderer.setRenderTarget(rtColor);renderer.render(scene,camera);
  scene.overrideMaterial=normalMat;const bg=scene.background;scene.background=new THREE.Color(.5,.5,1);
  renderer.setRenderTarget(rtNormal);renderer.render(scene,camera);
  scene.overrideMaterial=null;scene.background=bg;
  renderer.setRenderTarget(null);renderer.render(postScene,postCam);
}
// small JPEG of the area the model is framed in; drawn and read in one go (no preserveDrawingBuffer needed)
function thumbnail(){
  const a=VIEW.area;if(!a)return null;
  draw();
  const pr=renderer.getPixelRatio(),c=document.createElement('canvas');c.width=240;c.height=180;
  const g=c.getContext('2d'),sw=a.w*pr,sh=a.h*pr,k=Math.max(c.width/sw,c.height/sh);
  const cw=c.width/k,ch=c.height/k; // crop (cover) from the centre of the framed area
  g.fillStyle='#f3ede0';g.fillRect(0,0,c.width,c.height);
  g.drawImage(renderer.domElement,a.x*pr+(sw-cw)/2,a.y*pr+(sh-ch)/2,cw,ch,0,0,c.width,c.height);
  try{return c.toDataURL('image/jpeg',0.75);}catch{return null;}
}

// dev-only debug handle: window.viewer.{controls,camera,M,surfaceAtCenter,invalidate}
if(import.meta.env.DEV)window.viewer={controls,camera,M,surfaceAtCenter,invalidate,THREE,renderer,sun,scene,styled,draw};

// ===== Progress overlay =====
function fmtSec(s){return s<1?'меньше секунды':s<60?`≈ ${Math.ceil(s)} с`:`≈ ${Math.floor(s/60)} мин ${Math.ceil(s%60)} с`;}
function startProgress(label){
  document.body.classList.add('loading');PROG.t0=performance.now();PROG.last=0;
  $('pName').textContent=label?`«${label}»`:'';
  for(const b of document.querySelectorAll('button,input'))b.disabled=true;
  PROG.on=(f,l)=>{
    f=Math.max(0,Math.min(1,f));
    $('pBar').style.width=(f*100).toFixed(1)+'%';$('pPct').textContent=Math.floor(f*100)+'%';
    $('pStage').textContent=l||'';
    const el=(performance.now()-PROG.t0)/1000;
    $('pEta').textContent=(f>0.12&&el>0.4)?'осталось '+fmtSec(el*(1-f)/f):'';
    $('progress').setAttribute('aria-valuenow',Math.floor(f*100));
  };
  PROG.on(0,'Начинаю');
}
function stopProgress(){invalidate();PROG.on=null;document.body.classList.remove('loading');for(const b of document.querySelectorAll('button,input'))b.disabled=false;}
// ===== File loading UI =====
const fileIn=$('file'), dlg=$('openDlg');
const finePointer=matchMedia('(pointer:fine)');
function showErr(t){const el=dlg.open?$('msg3'):document.body.classList.contains('has-model')?$('msg2'):$('msg');el.className='msg err';el.textContent=t;}
function clearErr(){$('msg').textContent='';$('msg2').textContent='';$('msg3').textContent='';}
// src: {demo:true} | {id} (from history) | {} (a new file → saved to history)
async function openBuffer(buf,label,src={}){
  clearErr();startProgress(label);
  let m;
  try{m=await readLitematic(buf);await loadModel(m,label);}
  catch(e){console.error(e);showErr(e.message||'Не удалось прочитать файл');return false;}
  finally{stopProgress();}
  document.body.classList.toggle('is-demo',!!src.demo);
  $('crumb').textContent=src.demo?'Demo':label;
  const thumb=thumbnail();
  if(src.demo){CUR='demo';DEMO.thumb=thumb||DEMO.thumb;try{localStorage.setItem('demoThumb',DEMO.thumb||'');}catch{}}
  else{
    CUR=src.id||await hist.fileId(buf);
    try{await hist.save({id:CUR,name:label,dims:`${M.NX}×${M.NY}×${M.NZ}`,author:m.author||'',thumb,data:buf});}
    catch(e){console.warn('history not saved',e);}
  }
  try{localStorage.setItem('lastOpened',CUR);}catch{}
  return true;
}
async function openFile(f){
  if(!f)return;
  if(!/\.litematic$/i.test(f.name)){showErr(`«${f.name}» — не .litematic. Сохрани постройку в Litematica: M → Area Editor → Save Schematic.`);return;}
  if(dlg.open)dlg.close();
  closeMenu();
  openBuffer(await f.arrayBuffer(),f.name.replace(/\.litematic$/i,''));
}
// desktop: a dialog you can drop onto; touch devices go straight to the system picker
function askFile(){closeMenu();if(!finePointer.matches)return fileIn.click();clearErr();dlg.showModal();}
$('pick').onclick=()=>fileIn.click();
$('openBtn').onclick=askFile;
$('dlgClose').onclick=()=>dlg.close();
dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close();});
$('dlgZone').onclick=()=>fileIn.click();
$('dlgZone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fileIn.click();}};
fileIn.onchange=()=>{openFile(fileIn.files[0]);fileIn.value='';};
let CUR=null;
const DEMO={name:'Demo',dims:'20×45×26',thumb:null};
try{DEMO.thumb=localStorage.getItem('demoThumb')||null;}catch{}
async function openSample(){const res=await fetch(import.meta.env.BASE_URL+'sample.litematic');if(!res.ok)throw new Error(res.status);return openBuffer(await res.arrayBuffer(),'upd_plushki',{demo:true});}
$('sample').onclick=()=>openSample().catch(()=>showErr('Не удалось загрузить пример'));
async function openFromHistory(id){
  const e=await hist.get(id).catch(()=>null);
  if(!e){showErr('Файл не найден в истории');return false;}
  return openBuffer(e.data,e.name,{id});
}

// ===== History menu (the model name in the header) =====
const menu=$('histMenu'),sw=$('switcher');
const ago=t=>{const d=(Date.now()-t)/864e5;if(d<1&&new Date(t).getDate()===new Date().getDate())return 'сегодня';if(d<2)return 'вчера';return new Date(t).toLocaleDateString('ru',{day:'numeric',month:'short'});};
function row(e,isDemo){
  const li=document.createElement('li');li.className='hitem'+(CUR===(isDemo?'demo':e.id)?' cur':'');
  const b=document.createElement('button');b.className='hopen';
  const img=document.createElement(e.thumb?'img':'span');img.className='hthumb';if(e.thumb){img.src=e.thumb;img.alt='';}
  const t=document.createElement('span');t.className='htext';
  const n=document.createElement('b');n.textContent=e.name;
  const meta=document.createElement('small');meta.textContent=isDemo?`пример · ${e.dims}`:`${e.dims} · ${ago(e.viewed)}`;
  t.append(n,meta);b.append(img,t);
  b.onclick=async()=>{closeMenu();if(isDemo)openSample().catch(()=>showErr('Не удалось загрузить пример'));else openFromHistory(e.id);};
  li.append(b);
  if(!isDemo){
    const x=document.createElement('button');x.className='hdel';x.setAttribute('aria-label',`Удалить «${e.name}» из истории`);x.textContent='×';
    x.onclick=async ev=>{ev.stopPropagation();await hist.remove(e.id).catch(()=>{});renderMenu();};
    li.append(x);
  }
  return li;
}
async function renderMenu(){
  const items=await hist.list().catch(()=>[]);
  const ul=$('histList');ul.replaceChildren(row(DEMO,true));
  if(items.length){const h=document.createElement('li');h.className='hsep';h.textContent='Мои файлы';ul.append(h);}
  for(const e of items)ul.append(row(e,false));
  $('histEmpty').hidden=items.length>0;
}
function openMenu(){renderMenu();menu.hidden=false;sw.setAttribute('aria-expanded','true');document.body.classList.add('menu-open');}
function closeMenu(){if(menu.hidden)return;menu.hidden=true;sw.setAttribute('aria-expanded','false');document.body.classList.remove('menu-open');}
sw.onclick=e=>{e.stopPropagation();menu.hidden?openMenu():closeMenu();};
$('histOpen').onclick=askFile;
$('histClose').onclick=closeMenu;
addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target))closeMenu();});
addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});

// start with the last model this browser looked at; first visit (or nothing saved) → demo
(async()=>{
  let last=null;try{last=localStorage.getItem('lastOpened');}catch{}
  if(last&&last!=='demo'&&await openFromHistory(last).catch(()=>false))return;
  clearErr();
  openSample().catch(e=>console.warn('sample not loaded',e));
})();
// collapsible settings panel
const panel=$('panel');
function setCollapsed(c){panel.classList.toggle('collapsed',c);$('pToggle').setAttribute('aria-expanded',String(!c));}
// collapsing is a phone thing (CSS applies .collapsed only ≤560px): collapsed by default there, choice remembered
const narrow=matchMedia('(max-width:560px)');
setCollapsed(true);
try{if(localStorage.getItem('panelCollapsed')==='0')setCollapsed(false);}catch{}
$('pToggle').onclick=()=>{if(!narrow.matches)return;const c=!panel.classList.contains('collapsed');setCollapsed(c);try{localStorage.setItem('panelCollapsed',c?'1':'0');}catch{}resize();};
let dragDepth=0;
addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;document.body.classList.add('dragging');});
addEventListener('dragleave',e=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragging');}});
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');openFile(e.dataTransfer.files[0]);});
