import * as THREE from 'three';
import {GrowBuf,u8} from './buf.js';
import COLORS from './colors.json';
import {step} from './progress.js';

// shared model state (filled by setModel)
export const M={NX:0,NY:0,NZ:0,PAL:[],GRID:null,KIND:[],COLT:[],COLS:[],AUTO_CUT:0,CUT:0};
// ===== Blocks -> stylised geometry (generic rules by block id + state) =====
const CREAM=new THREE.Color('#f3ede0');
const styl=hex=>{const c=new THREE.Color(hex||'#999');const hsl={};c.getHSL(hsl);
  c.setHSL(hsl.h,Math.min(1,hsl.s*1.08),Math.min(0.92,hsl.l*0.92+0.1));return c.lerp(CREAM,0.1);};
const SKIP=new Set(['air','cave_air','void_air','light','glow_lichen','lever','tripwire','redstone_wire','structure_void']);
// classify palette
function classify(e){
  const n=e.n;
  if(SKIP.has(n))return 'skip';
  if(n.endsWith('_leaves'))return 'leaves';
  if(n.endsWith('_stairs'))return 'stairs';
  if(n.endsWith('_slab'))return e.p.type==='double'?'cube':'slab';
  if(n.endsWith('_pane')||n==='iron_bars')return 'pane';
  if(n.endsWith('_fence_gate'))return 'gate';
  if(n.endsWith('_fence'))return 'fence';
  if(n.endsWith('_wall_sign')||n.endsWith('_wall_banner')||n==='ladder'||n.endsWith('_wall_hanging_sign'))return 'wallplate';
  if(n.endsWith('_wall'))return 'wall';
  if(n.endsWith('_trapdoor'))return 'trapdoor';
  if(n.endsWith('_door'))return 'door';
  if(n.endsWith('_carpet'))return 'carpet';
  if(n.endsWith('_pressure_plate'))return 'plate';
  if(n.endsWith('rail'))return 'rail';
  if(n.endsWith('_button'))return 'skip';
  if(n.endsWith('candle'))return 'candle';
  if(n.endsWith('lantern'))return 'lantern';
  if(n.endsWith('torch'))return 'torch';
  if(n.endsWith('_shelf'))return 'shelf';
  if(n.endsWith('_hanging_sign')||n.endsWith('_sign')||n.endsWith('_banner'))return 'skip';
  if(n.includes('glass'))return 'glass';
  const small={player_head:[.5,.5],decorated_pot:[.7,.8],chest:[.875,.875],ender_chest:[.875,.875],trapped_chest:[.875,.875],
    anvil:[.8,1],campfire:[1,.44],end_rod:[.15,1],iron_chain:[.12,1],chain:[.12,1],flower_pot:[.4,.4],enchanting_table:[1,.75]};
  if(small[n]){e.box=small[n];return 'small';}
  if(n==='hopper')return 'hopper';
  if(n==='water'||n==='lava'||n==='bubble_column')return 'liquid';
  if(n==='snow')return 'layer';
  if(n.endsWith('_bed')){e.box=[1,.5625];return 'small';}
  if(n==='cake'||n.endsWith('candle_cake')){e.box=[.875,.5];return 'small';}
  if(n==='stonecutter'||n==='daylight_detector'||n==='enchanting_table'||n==='lectern'){e.box=[1,n==='stonecutter'?.5625:n==='daylight_detector'?.375:.75];return 'small';}
  if(n.startsWith('potted_')||n==='flower_pot'){e.box=[.4,.4];return 'small';}
  if(/(head|skull)$/.test(n)){e.box=[.5,.5];return 'small';}
  if(/(chest|_golem_statue)$/.test(n)){e.box=[.875,.875];return 'small';}
  if(/^(vine|sculk_vein|resin_clump|cobweb|tripwire_hook|scaffolding_?)$/.test(n))return 'skip';
  if(PLANT.test(n))return 'plant';
  return 'cube';
}
const PLANT=/(_sapling|_tulip|^poppy|^dandelion|^allium|^azure_bluet|^cornflower|^lily_of_the_valley|^oxeye_daisy|^wither_rose|^blue_orchid|^torchflower|^short_grass|^tall_grass|^grass$|^fern|^large_fern|^dead_bush|_mushroom$|_roots$|_fungus$|^sweet_berry_bush|^wheat|^carrots|^potatoes|^beetroots|seagrass|^kelp|^sugar_cane|_propagule|^pink_petals|^wildflowers|^leaf_litter|^bush$|^firefly_bush|eyeblossom|^pitcher|_crop$|^peony|^rose_bush|^lilac|^sunflower|^spore_blossom|^hanging_roots|^cave_vines|^weeping_vines|^twisting_vines|dripleaf|^azalea$|^flowering_azalea$|^cactus_flower|^nether_wart|^sea_pickle|^short_dry_grass|^tall_dry_grass|^cocoa|^bamboo_sapling|^lily_pad|_coral$|_coral_fan$|_coral_wall_fan$)/;
function colorOf(n){
  let v=COLORS[n];
  if(!v){ for(const k of [n.replace(/^waxed_/,''),n.replace(/_(stairs|slab|wall|fence_gate|fence|pressure_plate|button|sign|wall_sign|hanging_sign|wall_hanging_sign|carpet)$/,''),
      n.replace(/_(stairs|slab|wall)$/,'s'),n.replace(/_(stairs|slab|wall|fence|fence_gate|sign|wall_sign)$/,'_planks')]) if(COLORS[k]){v=COLORS[k];break;} }
  if(!v){ if(/snow|quartz|white|calcite|bone/.test(n))v='e8e6dd'; else if(/copper/.test(n))v='c06c4f'; else if(/grass|leaves|moss|vine/.test(n))v='6f9a4c';
    else if(/oak|spruce|birch|wood|plank|log|barrel/.test(n))v='a2834f'; else if(/water|ice/.test(n))v='6f9fd8'; else v='9a948a'; }
  return ['#'+v.slice(0,6),'#'+(v.length>6?v.slice(6,12):v.slice(0,6))];
}
export function setModel(m){
  M.NX=m.nx;M.NY=m.ny;M.NZ=m.nz;M.GRID=m.grid;
  M.PAL=m.palette.map(e=>{const [t,s]=colorOf(e.n);return {n:e.n,p:e.p,t,s};});
  M.KIND=M.PAL.map(classify);
  M.COLT=M.PAL.map(e=>styl(e.t));M.COLS=M.PAL.map(e=>styl(e.s));
  for(let i=0;i<M.PAL.length;i++)if(M.KIND[i]==='liquid'){M.COLT[i]=styl(M.PAL[i].n==='lava'?'#d96a1c':'#6f9fd8');M.COLS[i]=M.COLT[i];}
  M.AUTO_CUT=computeCut();
}
const idx=(x,y,z)=>x+M.NX*(y+M.NY*z);
const at=(x,y,z)=>(x<0||y<M.CUT||z<0||x>=M.NX||y>=M.NY||z>=M.NZ)?-1:M.GRID[idx(x,y,z)];
// automatic ground cut: first layer where built blocks outnumber natural terrain, minus 2
const NATURAL=/^(stone|dirt|coarse_dirt|rooted_dirt|andesite|granite|diorite|tuff|deepslate|gravel|sand|clay|podzol|grass_block|cobbled_deepslate|calcite|.*_ore)$/;
function computeCut(){let last=-1;for(let y=0;y<M.NY;y++){let n=0,nat=0;for(let z=0;z<M.NZ;z++)for(let x=0;x<M.NX;x++){const p=M.GRID[idx(x,y,z)];if(M.KIND[p]==='skip')continue;n++;if(NATURAL.test(M.PAL[p].n))nat++;}
  if(n&&nat/n>=0.5)last=y;}
  // never cut above open ground: 10th percentile of sky-exposed natural surface (incl. water), minus 2
  const SURF=/^(water|lava|ice|packed_ice|snow|snow_block)$/;
  const tops=[];for(let z=0;z<M.NZ;z++)for(let x=0;x<M.NX;x++){for(let y=M.NY-1;y>=0;y--){const p=M.GRID[idx(x,y,z)];const k=M.KIND[p];
    if(k==='skip'||k==='leaves'||k==='plant')continue; if(NATURAL.test(M.PAL[p].n)||SURF.test(M.PAL[p].n))tops.push(y); break;}}
  tops.sort((a,b)=>a-b);const p10=tops.length?tops[Math.floor(tops.length*0.1)]:M.NY;
  return Math.max(0,Math.min(last-1,p10-2));}
const occ=(x,y,z)=>{const p=at(x,y,z);return p>=0&&M.KIND[p]==='cube';};
const hash=(x,y,z)=>{let h=(x*374761393+y*668265263+z*1442695041)|0;h=Math.imul(h^(h>>>13),1274126177);return((h>>>0)%10000)/10000;};
const DIR={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]};
const PLANT_GREEN=new THREE.Color('#7fa65a');
const LEFT={north:'west',west:'south',south:'east',east:'north'}, RIGHT={north:'east',east:'south',south:'west',west:'north'};

export async function convert(p0,p1){
  // everything goes into typed buffers (see buf.js): triangles = positions + byte colours; boxes = centre, size,
  // colour; blobs = centre, radius, colour — no per-item objects
  const tri={pos:new GrowBuf(Float32Array),col:new GrowBuf(Uint8Array)};
  const boxes={g:new GrowBuf(Float32Array),c:new GrowBuf(Uint8Array),n:0}, blobs={g:new GrowBuf(Float32Array),c:new GrowBuf(Uint8Array),n:0};
  const blob=(px,py,pz,r,c)=>{blobs.g.push4(px,py,pz,r);blobs.c.push3(u8(c.r),u8(c.g),u8(c.b));blobs.n++;};
  const V=(x,y,z)=>new THREE.Vector3(x,y,z);
  const pushTri=(a,b,c,col,inside)=>{
    const n=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a));
    if(n.lengthSq()<1e-9)return;
    const cen=new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1/3);
    if(n.dot(cen.sub(inside))<0){const t=b;b=c;c=t;}
    const r=u8(col.r),g=u8(col.g),bl=u8(col.b);
    for(const v of [a,b,c]){tri.pos.push3(v.x,v.y,v.z);tri.col.push3(r,g,bl);}
  };
  const box=(x0,y0,z0,x1,y1,z1,c)=>{boxes.g.push3((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);
    boxes.g.push3(Math.max(x1-x0,.001),Math.max(y1-y0,.001),Math.max(z1-z0,.001));boxes.c.push3(u8(c.r),u8(c.g),u8(c.b));boxes.n++;};
  // box in block-local coords, rotated so that local -z points to `facing`
  const rbox=(x,y,z,facing,u0,y0,w0,u1,y1,w1,c)=>{ // u: across, w: depth from facing side (0) to back (1)
    let X0,X1,Z0,Z1;
    if(facing==='north'){X0=u0;X1=u1;Z0=w0;Z1=w1;}
    else if(facing==='south'){X0=1-u1;X1=1-u0;Z0=1-w1;Z1=1-w0;}
    else if(facing==='west'){Z0=1-u1;Z1=1-u0;X0=w0;X1=w1;}
    else {Z0=u0;Z1=u1;X0=1-w1;X1=1-w0;}
    box(x+X0,y+y0,z+Z0,x+X1,y+y1,z+Z1,c);
  };
  for(let z=0;z<M.NZ;z++){
  await step(p0+(p1-p0)*z/M.NZ,'Строю геометрию');
  for(let y=M.CUT;y<M.NY;y++)for(let x=0;x<M.NX;x++){
    const p=M.GRID[idx(x,y,z)], k=M.KIND[p]; if(k==='skip')continue;
    const e=M.PAL[p], P=e.p, ct=M.COLT[p], cs=M.COLS[p];
    switch(k){
    case 'cube': break; // handled by greedy meshing
    case 'stairs':{
      const f=P.facing, sh=P.shape||'straight';
      if(P.half==='top'){ box(x,y+.5,z,x+1,y+1,z+1,cs); rbox(x,y,z,f,0,0,0,1,.5,.5,cs); break; }
      // corner heights of a sloped wedge (high side = facing)
      const [fx,fz]=DIR[f], side=sh.includes('left')?LEFT[f]:RIGHT[f], [sx,sz]=DIR[side];
      const H=(cx,cz)=>{ // cx,cz in {0,1}
        const onF=(fx?(fx>0?cx:1-cx):(fz>0?cz:1-cz))===1;
        const onS=(sx?(sx>0?cx:1-cx):(sz>0?cz:1-cz))===1;
        if(sh==='straight')return onF?1:0;
        if(sh.startsWith('outer'))return onF&&onS?1:0;
        return onF||onS?1:0;
      };
      const h=[[H(0,0),H(0,1)],[H(1,0),H(1,1)]];
      const T=(cx,cz)=>V(x+cx,y+h[cx][cz],z+cz), Bt=(cx,cz)=>V(x+cx,y,z+cz);
      const inside=V(x+.5,y+.2,z+.5);
      // choose diagonal through the "special" corner for corners
      let diagA=true; // diag (0,0)-(1,1)
      if(sh!=='straight'){
        const vals=[h[0][0],h[1][1],h[1][0],h[0][1]];
        const odd=sh.startsWith('outer')?1:0; // the unique corner value
        const ci=[[0,0],[1,1],[1,0],[0,1]].find(([a,b])=>h[a][b]===odd);
        diagA=(ci[0]===ci[1]);
      }
      if(diagA){pushTri(T(0,0),T(1,0),T(1,1),ct,inside);pushTri(T(0,0),T(1,1),T(0,1),ct,inside);}
      else {pushTri(T(1,0),T(1,1),T(0,1),ct,inside);pushTri(T(1,0),T(0,1),T(0,0),ct,inside);}
      const sides=[[[1,0],[1,1],1,0,0],[[0,0],[0,1],-1,0,0],[[0,1],[1,1],0,0,1],[[0,0],[1,0],0,0,-1]];
      for(const [a,b,dx,dy,dz] of sides){
        if(occ(x+dx,y,z+dz))continue;
        if(h[a[0]][a[1]]===0&&h[b[0]][b[1]]===0)continue;
        pushTri(Bt(...a),Bt(...b),T(...b),cs,inside);pushTri(Bt(...a),T(...b),T(...a),cs,inside);
      }
      if(!occ(x,y-1,z)){pushTri(Bt(0,0),Bt(1,0),Bt(1,1),cs,inside);pushTri(Bt(0,0),Bt(1,1),Bt(0,1),cs,inside);}
      break;}
    case 'liquid':{
      const same=(xx,yy,zz)=>at(xx,yy,zz)===p;
      const top=same(x,y+1,z)?1:.875, inside=V(x+.5,y+.4,z+.5);
      for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        if(occ(x+dx,y+dy,z+dz)||same(x+dx,y+dy,z+dz))continue;
        const c=dy===1?ct:cs.clone().multiplyScalar(.9);
        const X0=x+(dx>0?1:0),Z0=z+(dz>0?1:0);
        let q;
        if(dx)q=[V(X0,y,z),V(X0,y,z+1),V(X0,y+top,z+1),V(X0,y+top,z)];
        else if(dz)q=[V(x,y,Z0),V(x+1,y,Z0),V(x+1,y+top,Z0),V(x,y+top,Z0)];
        else {const yy=dy>0?y+top:y;q=[V(x,yy,z),V(x+1,yy,z),V(x+1,yy,z+1),V(x,yy,z+1)];}
        pushTri(q[0],q[1],q[2],c,inside);pushTri(q[0],q[2],q[3],c,inside);
      }
      break;}
    case 'layer': box(x,y,z,x+1,y+.125*(+(P.layers||1)),z+1,ct); break;
    case 'plant':{
      const hh=hash(x,y,z);
      blob(x+.5,y+.28,z+.5,.3+.08*hh,ct.clone().lerp(PLANT_GREEN,/(sapling|grass|fern|bush|vine|kelp|seagrass|cane|roots|dripleaf|azalea|lily_pad|crop|wheat|carrots|potatoes|beetroots)/.test(e.n)?.4:0));
      break;}
    case 'slab': if(P.type==='top')box(x,y+.5,z,x+1,y+1,z+1,cs); else box(x,y,z,x+1,y+.5,z+1,cs); break;
    case 'glass': box(x,y,z,x+1,y+1,z+1,cs.clone().lerp(new THREE.Color('#b9d6de'),.6)); break;
    case 'pane':{
      const bars=e.n==='iron_bars', c=bars?cs.clone().multiplyScalar(.8):cs.clone().lerp(new THREE.Color('#b9d6de'),.6), t=bars?.08:.1;
      const a=.5-t/2,b=.5+t/2;
      box(x+a,y,z+a,x+b,y+1,z+b,c);
      if(P.north==='true')box(x+a,y,z,x+b,y+1,z+a,c); if(P.south==='true')box(x+a,y,z+b,x+b,y+1,z+1,c);
      if(P.west==='true')box(x,y,z+a,x+a,y+1,z+b,c); if(P.east==='true')box(x+b,y,z+a,x+1,y+1,z+b,c);
      break;}
    case 'fence':{
      box(x+.375,y,z+.375,x+.625,y+1,z+.625,cs);
      for(const yy of [.38,.78]){const y0=y+yy,y1=y0+.14;
        if(P.north==='true')box(x+.44,y0,z,x+.56,y1,z+.375,cs); if(P.south==='true')box(x+.44,y0,z+.625,x+.56,y1,z+1,cs);
        if(P.west==='true')box(x,y0,z+.44,x+.375,y1,z+.56,cs); if(P.east==='true')box(x+.625,y0,z+.44,x+1,y1,z+.56,cs);}
      break;}
    case 'gate': if(P.open!=='true')rbox(x,y,z,P.facing,0,.3,.44,1,.95,.56,cs); break;
    case 'wall':{
      box(x+.25,y,z+.25,x+.75,y+1,z+.75,cs);
      const hgt=s=>s==='tall'?1:.875;
      if(P.north&&P.north!=='none')box(x+.31,y,z,x+.69,y+hgt(P.north),z+.25,cs);
      if(P.south&&P.south!=='none')box(x+.31,y,z+.75,x+.69,y+hgt(P.south),z+1,cs);
      if(P.west&&P.west!=='none')box(x,y,z+.31,x+.25,y+hgt(P.west),z+.69,cs);
      if(P.east&&P.east!=='none')box(x+.75,y,z+.31,x+1,y+hgt(P.east),z+.69,cs);
      break;}
    case 'trapdoor':
      if(P.open==='true')rbox(x,y,z,P.facing,0,0,.8125,1,1,1,cs);
      else if(P.half==='top')box(x,y+.8125,z,x+1,y+1,z+1,cs); else box(x,y,z,x+1,y+.1875,z+1,cs);
      break;
    case 'door': rbox(x,y,z,P.facing,0,0,.8125,1,1,1,cs); break;
    case 'wallplate':{
      const ban=e.n.endsWith('_banner');
      rbox(x,y,z,P.facing,ban?.1:0,ban?-.7:.25,.92,ban?.9:1,ban?.95:.8,1,cs); break;}
    case 'carpet': box(x,y,z,x+1,y+.0625,z+1,cs); break;
    case 'plate': box(x+.06,y,z+.06,x+.94,y+.06,z+.94,cs); break;
    case 'rail': box(x+.1,y,z+.1,x+.9,y+.05,z+.9,cs.clone().multiplyScalar(.75)); break;
    case 'candle': box(x+.42,y,z+.42,x+.58,y+.42,z+.58,cs); break;
    case 'lantern': if(P.hanging==='true')box(x+.32,y+.06,z+.32,x+.68,y+.56,z+.68,cs); else box(x+.32,y,z+.32,x+.68,y+.5,z+.68,cs); break;
    case 'torch': box(x+.44,y,z+.44,x+.56,y+.62,z+.56,cs); break;
    case 'shelf': rbox(x,y,z,P.facing,0,0,.625,1,1,1,cs); break;
    case 'hopper': box(x,y+.625,z,x+1,y+1,z+1,cs); box(x+.25,y+.25,z+.25,x+.75,y+.625,z+.75,cs); break;
    case 'small':{const [w,hh]=e.box,a=(1-w)/2; box(x+a,y,z+a,x+1-a,y+hh,z+1-a,cs); break;}
    case 'leaves':{
      let exposed=false; for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const q=at(x+dx,y+dy,z+dz);if(q<0||M.KIND[q]==='skip')exposed=true;}
      if(!exposed)break;
      const hh=hash(x,y,z);
      blob(x+.5+(hash(y,z,x)-.5)*.3,y+.5+(hash(z,x,y)-.5)*.3,z+.5+(hash(x,z,y)-.5)*.3,.72+.22*hh,ct.clone().multiplyScalar(.92+.16*hh));
      break;}
    }
  }
  }
  return {tri,boxes,blobs};
}

export {at,hash,idx};
