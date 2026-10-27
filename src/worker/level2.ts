type Row=Record<string,unknown>;
export type Level2Env={LEVEL2_GATEWAY_URL?:string;LEVEL2_GATEWAY_TOKEN?:string};
export async function level2(symbol:string,env:Level2Env){
 const base={available:true,symbol,connected:false,licensed:false,provider:null,asOf:null,depth:0,bids:[],asks:[],trades:[],orders:[]};
 if(!env.LEVEL2_GATEWAY_URL||!env.LEVEL2_GATEWAY_TOKEN)return {...base,status:'not-configured',notice:'Level-2 授权接入已预留；配置行情商网关后可显示十档、逐笔成交和逐笔委托。当前公开五档另行展示。'};
 const target=new URL(env.LEVEL2_GATEWAY_URL);if(target.protocol!=='https:')throw new Error('Level-2 网关必须使用HTTPS');target.searchParams.set('symbol',symbol);
 const response=await fetch(target,{headers:{Authorization:'Bearer '+env.LEVEL2_GATEWAY_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(6000)});
 if(!response.ok)return {...base,status:'provider-unavailable',notice:'授权行情商暂不可用，请稍后重试。'};
 const r=await response.json() as Row,stamp=typeof r.asOf==='string'?Date.parse(r.asOf):NaN;
 if(r.licensed!==true||r.symbol!==symbol||typeof r.provider!=='string'||!Number.isFinite(stamp)||stamp>Date.now()+60000)throw new Error('Level-2 网关证券、授权或时间戳无效');
 const levels=(value:unknown)=>Array.isArray(value)?value.slice(0,10).map(v=>{const p=v as Row;if(typeof p.price!=='number'||!Number.isFinite(p.price)||p.price<=0||typeof p.volume!=='number'||!Number.isFinite(p.volume)||p.volume<0)throw new Error('Level-2 深度字段无效');return {price:p.price,volume:p.volume};}):[];
 const records=(value:unknown)=>Array.isArray(value)?value.slice(-200).map(v=>{const p=v as Row;return {id:String(p.id||'').slice(0,80),time:String(p.time||'').slice(0,40),price:typeof p.price==='number'?p.price:null,volume:typeof p.volume==='number'?p.volume:null,side:['B','S'].includes(String(p.side))?String(p.side):'unknown',action:['add','cancel','trade'].includes(String(p.action))?String(p.action):'unknown'};}):[];
 const bids=levels(r.bids),asks=levels(r.asks),stale=Date.now()-stamp>120000;
 return {...base,connected:true,licensed:true,status:stale?'stale':'connected',stale,provider:r.provider.slice(0,80),asOf:r.asOf,volumeUnit:r.volumeUnit==='手'?'手':'股',depth:Math.min(bids.length,asks.length),bids,asks,trades:records(r.trades),orders:records(r.orders),notice:stale?'当前授权快照已过期，不视为实时。':'授权行情商数据；档位和逐笔覆盖以实际权限为准。'};
}
