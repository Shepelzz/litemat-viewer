import * as THREE from 'three';
import {M} from './convert.js';
import {step} from './progress.js';

// ===== Greedy meshing: merges coplanar faces of equal colour into big rectangles =====
const ORD_P=[0,1,2,0,2,3],ORD_N=[0,2,1,0,3,2],NRM=[[1,0,0],[0,1,0],[0,0,1]],Q=[0,0,0];
class FBuf{constructor(n=1<<16){this.a=new Float32Array(n);this.n=0;}
  grow(k){if(this.n+k>this.a.length){let L=this.a.length*2;while(L<this.n+k)L*=2;const b=new Float32Array(L);b.set(this.a.subarray(0,this.n));this.a=b;}}
  view(){return this.a.subarray(0,this.n);}}
export async function greedyMesh(solidOf,occOf,colTop,colSide,p0,p1,label){
  const key=new Map(),cols=[];
  const cid=c=>{const k=c.getHex();if(!key.has(k)){key.set(k,cols.length);cols.push([c.r,c.g,c.b]);}return key.get(k);};
  const topId=new Int32Array(M.PAL.length),sideId=new Int32Array(M.PAL.length),botId=new Int32Array(M.PAL.length);
  for(let i=0;i<M.PAL.length;i++){topId[i]=cid(colTop[i]);sideId[i]=cid(colSide[i]);botId[i]=cid(colSide[i].clone().multiplyScalar(.85));}
  const pos=new FBuf(),nor=new FBuf(),col=new FBuf();
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
          const g=M.GRID[gi];
          if(!solidOf[g]){mask[k]=0;continue;}
          if(nIn&&occOf[M.GRID[gi+off]]){mask[k]=0;continue;}
          mask[k]=ids[g]+1;
        }}
        const plane=s+(sign>0?1:0);
        k=0;
        for(let j=0;j<Wv;j++)for(let i=0;i<Wu;){
          const c=mask[j*Wu+i];if(!c){i++;continue;}
          let w=1;while(i+w<Wu&&mask[j*Wu+i+w]===c)w++;
          let h=1;outer:for(;j+h<Wv;h++){for(let t=0;t<w;t++)if(mask[(j+h)*Wu+i+t]!==c)break outer;}
          for(let r=0;r<h;r++)mask.fill(0,(j+r)*Wu+i,(j+r)*Wu+i+w);
          // corners without allocations
          const bu=i+lo[u],bv=j+lo[v];
          pos.grow(18);nor.grow(18);col.grow(18);const cc=cols[c-1];
          const order=sign>0?ORD_P:ORD_N;
          for(let t=0;t<6;t++){const o=order[t];
            const cu=bu+((o===1||o===2)?w:0), cv=bv+((o===2||o===3)?h:0);
            Q[d]=plane;Q[u]=cu;Q[v]=cv;
            pos.a[pos.n++]=Q[0];pos.a[pos.n++]=Q[1];pos.a[pos.n++]=Q[2];
            nor.a[nor.n++]=NRM[d][0]*sign;nor.a[nor.n++]=NRM[d][1]*sign;nor.a[nor.n++]=NRM[d][2]*sign;
            col.a[col.n++]=cc[0];col.a[col.n++]=cc[1];col.a[col.n++]=cc[2];}
          i+=w;
        }
      }
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos.view().slice(),3));
  g.setAttribute('normal',new THREE.BufferAttribute(nor.view().slice(),3));
  g.setAttribute('color',new THREE.BufferAttribute(col.view().slice(),3));
  return g;
}
