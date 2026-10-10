import * as THREE from 'three';
import {M} from './convert.js';
import {step} from './progress.js';
import {GrowBuf,u8} from './buf.js';

// ===== Greedy meshing: merges coplanar faces of equal colour into big rectangles =====
const ORD_P=[0,1,2,0,2,3],ORD_N=[0,2,1,0,3,2],NRM=[[1,0,0],[0,1,0],[0,0,1]],Q=[0,0,0];
// One pass over the grid for several layers at once (e.g. cubes + glass): layers = [{solid, occ, colTop, colSide}],
// each block belongs to the first layer whose `solid` has it; a face is drawn unless the neighbour is in that layer's
// `occ`. Faces only merge within a layer. Returns one geometry per layer.
export async function greedyMeshLayers(layers,p0,p1,label){
  const NL=layers.length,key=new Map(),cols=[],colLayer=[];
  const cid=(L,c)=>{const k=L+':'+c.getHex();if(!key.has(k)){key.set(k,cols.length);cols.push([u8(c.r),u8(c.g),u8(c.b)]);colLayer.push(L);}return key.get(k);};
  const P=M.PAL.length,layerOf=new Int8Array(P).fill(-1);
  const topId=new Int32Array(P),sideId=new Int32Array(P),botId=new Int32Array(P);
  for(let i=0;i<P;i++)for(let L=0;L<NL;L++)if(layers[L].solid[i]){const D=layers[L];layerOf[i]=L;
    topId[i]=cid(L,D.colTop[i]);sideId[i]=cid(L,D.colSide[i]);botId[i]=cid(L,D.colSide[i].clone().multiplyScalar(.85));break;}
  // occlusion per (layer, neighbour palette index), flattened
  const occ=new Uint8Array(NL*P);for(let L=0;L<NL;L++)occ.set(layers[L].occ,L*P);
  // compact vertex data: merged faces sit on whole block coordinates (Int16), axis normals (Int8), byte colours
  const out=layers.map(()=>({pos:new GrowBuf(Int16Array),nor:new GrowBuf(Int8Array),col:new GrowBuf(Uint8Array)}));
  const dims=[M.NX,M.NY,M.NZ],lo=[0,M.CUT,0],S=[1,M.NX,M.NX*M.NY];
  const total=2*((M.NX)+(M.NY-M.CUT)+(M.NZ));let done=0;
  for(let d=0;d<3;d++){
    const u=(d+1)%3,v=(d+2)%3,Wu=dims[u]-lo[u],Wv=dims[v]-lo[v];
    const mask=new Int32Array(Wu*Wv);
    for(const sign of [1,-1]){
      const ids=d===1?(sign>0?topId:botId):sideId;
      for(let s=lo[d];s<dims[d];s++){
        await step(p0+(p1-p0)*(done++)/total,label);
        const ns=s+sign,nIn=ns>=lo[d]&&ns<dims[d];
        let k=0;
        const sd=S[d],su=S[u],sv=S[v],off=sign*sd;
        for(let j=0;j<Wv;j++){let gi=s*sd+lo[u]*su+(j+lo[v])*sv;for(let i=0;i<Wu;i++,k++,gi+=su){
          const g=M.GRID[gi],L=layerOf[g];
          if(L<0){mask[k]=0;continue;}
          if(nIn&&occ[L*P+M.GRID[gi+off]]){mask[k]=0;continue;}
          mask[k]=ids[g]+1;
        }}
        const plane=s+(sign>0?1:0);
        for(let j=0;j<Wv;j++)for(let i=0;i<Wu;){
          const c=mask[j*Wu+i];if(!c){i++;continue;}
          let w=1;while(i+w<Wu&&mask[j*Wu+i+w]===c)w++;
          let h=1;outer:for(;j+h<Wv;h++){for(let t=0;t<w;t++)if(mask[(j+h)*Wu+i+t]!==c)break outer;}
          for(let r=0;r<h;r++)mask.fill(0,(j+r)*Wu+i,(j+r)*Wu+i+w);
          // corners without allocations
          const bu=i+lo[u],bv=j+lo[v],cc=cols[c-1],{pos,nor,col}=out[colLayer[c-1]];
          pos.grow(18);nor.grow(18);col.grow(18);
          const order=sign>0?ORD_P:ORD_N;
          for(let t=0;t<6;t++){const o=order[t];
            const cu=bu+((o===1||o===2)?w:0), cv=bv+((o===2||o===3)?h:0);
            Q[d]=plane;Q[u]=cu;Q[v]=cv;
            pos.a[pos.n++]=Q[0];pos.a[pos.n++]=Q[1];pos.a[pos.n++]=Q[2];
            nor.a[nor.n++]=NRM[d][0]*sign*127;nor.a[nor.n++]=NRM[d][1]*sign*127;nor.a[nor.n++]=NRM[d][2]*sign*127;
            col.a[col.n++]=cc[0];col.a[col.n++]=cc[1];col.a[col.n++]=cc[2];}
          i+=w;
        }
      }
    }
  }
  return out.map(({pos,nor,col})=>{const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos.trim(),3));
    g.setAttribute('normal',new THREE.BufferAttribute(nor.trim(),3,true));
    g.setAttribute('color',new THREE.BufferAttribute(col.trim(),3,true));
    return g;});
}
export async function greedyMesh(solidOf,occOf,colTop,colSide,p0,p1,label){
  return (await greedyMeshLayers([{solid:solidOf,occ:occOf,colTop,colSide}],p0,p1,label))[0];
}
