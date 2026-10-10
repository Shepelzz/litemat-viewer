import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import {PROG,step} from './progress.js';
import {readLitematic} from './litematic.js';
import {M,setModel,convert,at,hash} from './convert.js';
import {greedyMesh} from './greedy.js';

// ===== Rendering: toon shading + ink outlines =====
const view=document.getElementById('view');
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);
const BG=new THREE.Color('#f3ede0');
const scene=new THREE.Scene(); scene.background=BG;
const camera=new THREE.OrthographicCamera(-1,1,1,-1,1,600);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.maxPolarAngle=Math.PI*0.48; controls.minZoom=0.5; controls.maxZoom=6;
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
  Object.assign(sun.shadow.camera,{left:-S-6,right:S+6,top:S+6,bottom:-S-6,near:1,far:S*8+50});sun.shadow.camera.updateProjectionMatrix();
  sun.position.set(-0.45*S*3,0.8*S*3,0.55*S*3); sun.target.position.set(0,H/3,0);
  controls.target.set(0,H*0.42,0);
  VIEW.fh=Math.max(H*1.25,R*1.9);
  camera.zoom=1;post.uniforms.depthScale.value=S*12+99;camera.position.set(VIEW.dir[0]*S*5,VIEW.dir[1]*S*5+H*0.42,VIEW.dir[2]*S*5);camera.far=S*12+100;
  resize();
}
function inst(geo,mat,items,fn){const im=new THREE.InstancedMesh(geo,mat,Math.max(items.length,1));im.count=items.length;
  items.forEach((it,i)=>{const [m,c]=fn(it);im.setMatrixAt(i,m);if(c)im.setColorAt(i,c);});im.castShadow=im.receiveShadow=true;return im;}
let triCount=0, rawDirty=true;
async function buildRaw(){ // 'as in game' view, built on demand
  if(!rawDirty)return; rawDirty=false; clear(cubes);
  const solid=new Uint8Array(M.PAL.length);for(let i=0;i<M.PAL.length;i++)solid[i]=M.KIND[i]==='skip'?0:1;
  const ct=M.PAL.map(e=>new THREE.Color(e.t)),cs=M.PAL.map(e=>new THREE.Color(e.s));
  const g=await greedyMesh(solid,solid,ct,cs,0,1,'Готовлю вид «как в игре»');
  const cm=new THREE.Mesh(g,new THREE.MeshLambertMaterial({vertexColors:true}));cm.castShadow=cm.receiveShadow=true;cubes.add(cm);
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
    const tm=new THREE.Mesh(g,toonMat);tm.castShadow=tm.receiveShadow=true;styled.add(tm);}
  const solidT=new Uint8Array(M.PAL.length),occT=new Uint8Array(M.PAL.length);
  for(let i=0;i<M.PAL.length;i++){solidT[i]=occT[i]=M.KIND[i]==='cube'?1:0;}
  const gg=await greedyMesh(solidT,occT,M.COLT,M.COLS,p0+(p1-p0)*0.82,p0+(p1-p0)*0.95,'Склеиваю грани');
  if(my!==buildId)return false;
  const gm=new THREE.Mesh(gg,toonMat);gm.castShadow=gm.receiveShadow=true;styled.add(gm);
  await step(p0+(p1-p0)*0.96,'Собираю сцену',true);
  if(s.boxes.length)styled.add(inst(new THREE.BoxGeometry(1,1,1),toon({color:0xffffff}),s.boxes,o=>[o.m,o.c]));
  // level of detail for foliage on big maps
  let blobs=s.blobs, det=2;
  if(blobs.length>60000){blobs=blobs.filter(o=>hash(o.p.x|0,o.p.y|0,o.p.z|0)<0.5);for(const o of blobs)o.r*=1.22;}
  det=blobs.length>40000?0:blobs.length>12000?1:2;
  const blob=new THREE.IcosahedronGeometry(1,det);
  if(blobs.length)styled.add(inst(blob,toon({color:0xffffff}),blobs,o=>[new THREE.Matrix4().compose(o.p,new THREE.Quaternion(),new THREE.Vector3(o.r,o.r*.9,o.r)),o.c]));
  triCount=s.tri.pos.length/9+gg.attributes.position.count/3+s.boxes.length*12+blobs.length*blob.attributes.position.count/3;
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
      float d=abs(D(uv+vec2(o.x,0))-D(uv-vec2(o.x,0)))+abs(D(uv+vec2(0,o.y))-D(uv-vec2(0,o.y)));
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
  $('mCube').setAttribute('aria-pressed',st.mode==='cube');$('mToon').setAttribute('aria-pressed',st.mode==='toon');
  styled.visible=st.mode==='toon';cubes.visible=st.mode==='cube';$('panel').classList.toggle('off',st.mode==='cube');
  post.uniforms.lines.value=$('lines').checked?1:0; sun.castShadow=$('shadows').checked;
  $('stats').textContent=!loaded?'':st.mode==='cube'?'Исходные блоки, как в игре':`~${Math.round(triCount).toLocaleString('ru')} треугольников`;
}
$('mCube').onclick=async()=>{st.mode='cube';if(rawDirty){startProgress('');try{await buildRaw();}finally{stopProgress();}}sync();};$('mToon').onclick=()=>{st.mode='toon';sync();};
$('lines').addEventListener('input',sync);
let rb=0;$('cut').addEventListener('input',()=>{M.CUT=+$('cut').value;$('oCut').textContent=M.CUT;cancelAnimationFrame(rb);rb=requestAnimationFrame(async()=>{if(await rebuild()!==false)frameModel();});});$('shadows').addEventListener('input',sync);
const VIEW={dir:[-0.55,0.62,0.56],fh:40};
camera.position.set(VIEW.dir[0]*200,VIEW.dir[1]*200,VIEW.dir[2]*200);
function resize(){
  const w=view.clientWidth,h=view.clientHeight,a=w/h,fh=VIEW.fh*(w<600?1.25:1);
  const off=(w>860&&loaded)?150/h*fh:0; camera.left=-fh*a/2-off;camera.right=fh*a/2-off;camera.top=fh/2;camera.bottom=-fh/2;camera.updateProjectionMatrix();
  renderer.setSize(w,h,false);
  const dw=Math.floor(w*renderer.getPixelRatio()),dh=Math.floor(h*renderer.getPixelRatio());
  rtColor.setSize(dw,dh);rtNormal.setSize(dw,dh);post.uniforms.res.value.set(dw,dh);post.uniforms.px.value=renderer.getPixelRatio();
}
addEventListener('resize',resize);resize();
async function loadModel(m,label){
  setModel(m); M.CUT=M.AUTO_CUT; loaded=true;
  $('cut').max=Math.max(1,M.NY-4);$('cut').value=M.CUT;$('oCut').textContent=M.CUT;
  $('title').textContent=m.name||label||'Схематика';
  $('meta').textContent=[m.author&&('автор: '+m.author),`${M.NX}×${M.NY}×${M.NZ}`].filter(Boolean).join(', ');
  await rebuild(0.42,0.97); frameModel();
  await step(0.99,'Рисую',true);
  document.body.classList.add('has-model');
}
(function loop(){
  requestAnimationFrame(loop);controls.update();
  if(document.body.classList.contains('loading'))return; // don't spend the frame budget on rendering while we build
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
})();

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
function stopProgress(){PROG.on=null;document.body.classList.remove('loading');for(const b of document.querySelectorAll('button,input'))b.disabled=false;}
// cut slider rebuilds: show a slim bar without blocking
// ===== File loading UI =====
const fileIn=$('file');
function showErr(t){const el=document.body.classList.contains('has-model')?$('msg2'):$('msg');el.className='msg err';el.textContent=t;}
function clearErr(){$('msg').textContent='';$('msg2').textContent='';}
async function openBuffer(buf,label){
  clearErr();startProgress(label);
  try{const m=await readLitematic(buf);await loadModel(m,label);}
  catch(e){console.error(e);showErr(e.message||'Не удалось прочитать файл');}
  finally{stopProgress();}
}
async function openFile(f){
  if(!f)return;
  if(!/\.litematic$/i.test(f.name)){showErr(`«${f.name}» — не .litematic. Сохрани постройку в Litematica: M → Area Editor → Save Schematic.`);return;}
  openBuffer(await f.arrayBuffer(),f.name.replace(/\.litematic$/i,''));
}
$('pick').onclick=$('pick2').onclick=()=>fileIn.click();
fileIn.onchange=()=>{openFile(fileIn.files[0]);fileIn.value='';};
$('sample').onclick=async()=>{const res=await fetch(import.meta.env.BASE_URL+'sample.litematic');openBuffer(await res.arrayBuffer(),'upd_plushki');};
let dragDepth=0;
addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;document.body.classList.add('dragging');});
addEventListener('dragleave',e=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragging');}});
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');openFile(e.dataTransfer.files[0]);});
