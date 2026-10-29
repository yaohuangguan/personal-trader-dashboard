/** Shanghai clock; lunch is compressed, unobserved trading minutes stay empty. */
export function sessionMinute(clock:string):number|null {
 const m=/^(\d{2}):(\d{2})/.exec(clock);if(!m)return null;
 const minute=Number(m[1])*60+Number(m[2]);
 if(minute>=570&&minute<=690)return minute-570;
 if(minute>=780&&minute<=900)return 120+minute-780;
 return null;
}
export function sessionGrid(date:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];
 const out:{time:number;clock:string}[]=[];
 for(let m=570;m<=900;m++)if(m<=690||m>=780){
  const clock=String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  out.push({clock,time:Date.parse(date+'T'+clock+':00+08:00')/1000});
 }
 return out;
}
export function defaultBenchmark(symbol:string){return /^(300|301)/.test(symbol)?'399006.SZ':/^68[89]/.test(symbol)?'000688.SH':symbol.endsWith('.SH')?'000001.SH':symbol.endsWith('.BJ')?'899050.BJ':'399001.SZ';}
