// ===== Progress reporting: yields to the browser so the bar can repaint =====
export const PROG={t0:0,last:0,on:null};
function nextFrame(){return new Promise(r=>setTimeout(r,0));} // a macrotask boundary lets the browser paint the bar
export async function step(frac,label,force){
  if(PROG.on)PROG.on(frac,label);
  const now=performance.now();
  if(force||now-PROG.last>45){await nextFrame();PROG.last=performance.now();}
}
