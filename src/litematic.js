import {step} from './progress.js';

// ===== Litematica reader: gzip -> NBT -> merged block grid =====
async function gunzip(buf){
  const ds=new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer());
}
function parseNBT(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength); let o=0;
  const td=new TextDecoder();
  const str=()=>{const n=dv.getUint16(o);o+=2;const s=td.decode(u8.subarray(o,o+n));o+=n;return s;};
  const payload=t=>{
    switch(t){
      case 1:{const v=dv.getInt8(o);o+=1;return v;}
      case 2:{const v=dv.getInt16(o);o+=2;return v;}
      case 3:{const v=dv.getInt32(o);o+=4;return v;}
      case 4:{const v=dv.getInt32(o)*4294967296+dv.getUint32(o+4);o+=8;return v;}
      case 5:{const v=dv.getFloat32(o);o+=4;return v;}
      case 6:{const v=dv.getFloat64(o);o+=8;return v;}
      case 7:{const n=dv.getInt32(o);o+=4;const v=u8.slice(o,o+n);o+=n;return v;}
      case 8:return str();
      case 9:{const et=dv.getUint8(o);o+=1;const n=dv.getInt32(o);o+=4;const a=[];for(let i=0;i<n;i++)a.push(payload(et));return a;}
      case 10:{const c={};for(;;){const tt=dv.getUint8(o);o+=1;if(tt===0)break;const k=str();c[k]=payload(tt);}return c;}
      case 11:{const n=dv.getInt32(o);o+=4;const a=new Int32Array(n);for(let i=0;i<n;i++){a[i]=dv.getInt32(o);o+=4;}return a;}
      // long arrays (packed BlockStates — hundreds of MB on big maps) aren't copied: just remember where they are
      case 12:{const n=dv.getInt32(o);o+=4;const off=o;o+=n*8;return {longs:{dv,off,n}};}
      default:throw new Error('Неизвестный тег NBT '+t);
    }
  };
  const t=dv.getUint8(o);o+=1;if(t!==10)throw new Error('Файл не похож на NBT');str();
  return payload(10);
}
export async function readLitematic(buf){
  await step(0.02,'Распаковываю файл',true);
  let u8=new Uint8Array(buf);
  if(u8[0]===0x1f&&u8[1]===0x8b)u8=await gunzip(buf);
  await step(0.08,'Читаю NBT',true);
  const root=parseNBT(u8);
  await step(0.14,'Читаю NBT',true);
  if(!root.Regions||typeof root.Regions!=='object')throw new Error('В файле нет регионов Litematica');
  const regs=[];
  for(const [name,r] of Object.entries(root.Regions)){
    const P=r.Position,S=r.Size;
    const sx=Math.abs(S.x),sy=Math.abs(S.y),sz=Math.abs(S.z);
    const min={x:P.x+(S.x<0?S.x+1:0),y:P.y+(S.y<0?S.y+1:0),z:P.z+(S.z<0?S.z+1:0)};
    regs.push({name,min,sx,sy,sz,pal:r.BlockStatePalette||[],bits:r.BlockStates});
  }
  if(!regs.length)throw new Error('В схематике нет ни одного региона');
  const lo={x:Infinity,y:Infinity,z:Infinity},hi={x:-Infinity,y:-Infinity,z:-Infinity};
  for(const r of regs){lo.x=Math.min(lo.x,r.min.x);lo.y=Math.min(lo.y,r.min.y);lo.z=Math.min(lo.z,r.min.z);
    hi.x=Math.max(hi.x,r.min.x+r.sx);hi.y=Math.max(hi.y,r.min.y+r.sy);hi.z=Math.max(hi.z,r.min.z+r.sz);}
  let nx=hi.x-lo.x,ny=hi.y-lo.y,nz=hi.z-lo.z;
  if(nx*ny*nz>200e6)throw new Error(`Схематика ${nx}×${ny}×${nz} не поместится в память браузера (нужно больше ~400 МБ только под сетку блоков).`);
  // palette first, so the grid can be 1 byte per block when there are ≤256 distinct states (the grid is the
  // biggest single allocation: one cell per block, air included)
  const palette=[{n:'air',p:{}}], key=new Map([['minecraft:air',0]]);
  for(const r of regs)r.map=r.pal.map(e=>{
    if(/^(minecraft:)?(air|cave_air|void_air)$/.test(e.Name))return 0;
    const props=e.Properties||{}; const k=e.Name+JSON.stringify(props);
    if(!key.has(k)){key.set(k,palette.length);palette.push({n:e.Name.replace(/^minecraft:/,''),p:props});}
    return key.get(k);
  });
  const Grid=palette.length<=256?Uint8Array:Uint16Array;
  const grid=new Grid(nx*ny*nz);
  let doneVol=0; const totVol=regs.reduce((a,r)=>a+r.sx*r.sy*r.sz,0)||1;
  for(const r of regs){
    const map=r.map;
    if(!r.bits||!r.bits.longs)continue;
    // 32-bit word w of the packed long array, low word first (big-endian longs, read in place)
    const L=r.bits.longs, words=L.n*2, wordAt=w=>w<words?L.dv.getUint32(L.off+((w>>>1)<<3)+(w&1?0:4)):0;
    const bits=Math.max(2,Math.ceil(Math.log2(Math.max(2,r.pal.length)))), mask=bits>=32?0xffffffff:(1<<bits)-1;
    const ox=r.min.x-lo.x,oy=r.min.y-lo.y,oz=r.min.z-lo.z;
    let i=0;
    for(let y=0;y<r.sy;y++){
    await step(0.15+0.25*(doneVol+y*r.sx*r.sz)/totVol,'Распаковываю блоки');
    for(let z=0;z<r.sz;z++)for(let x=0;x<r.sx;x++,i++){
      const b=i*bits, w=b>>>5, s=b&31;
      let v=wordAt(w)>>>s; if(s+bits>32)v|=wordAt(w+1)<<(32-s); v=(v&mask)>>>0;
      const g=map[v]; if(g)grid[(x+ox)+nx*((y+oy)+ny*(z+oz))]=g;
    }}
    doneVol+=r.sx*r.sy*r.sz;
  }
  await step(0.41,'Обрезаю пустоту',true);
  // crop empty space
  let x0=nx,y0=ny,z0=nz,x1=-1,y1=-1,z1=-1;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(grid[x+nx*(y+ny*z)]&&palette[grid[x+nx*(y+ny*z)]].n!=='air'){
    if(x<x0)x0=x;if(y<y0)y0=y;if(z<z0)z0=z;if(x>x1)x1=x;if(y>y1)y1=y;if(z>z1)z1=z;}
  if(x1<0)throw new Error('Схематика пустая — в ней только воздух');
  const cx=x1-x0+1,cy=y1-y0+1,cz=z1-z0+1;
  // nothing to crop → keep the grid as is (a copy would briefly double the biggest allocation)
  let g2=grid;
  if(cx!==nx||cy!==ny||cz!==nz){g2=new Grid(cx*cy*cz);
    for(let z=0;z<cz;z++)for(let y=0;y<cy;y++)for(let x=0;x<cx;x++)g2[x+cx*(y+cy*z)]=grid[(x+x0)+nx*((y+y0)+ny*(z+z0))];}
  const md=root.Metadata||{};
  return {nx:cx,ny:cy,nz:cz,palette,grid:g2,name:md.Name||'',author:md.Author||'',regions:regs.length};
}
