import {useLiveEndpoint} from '../hooks/useLiveEndpoint';
import {t} from '../preferences';
type Level={price:number;volume:number};
type RecordRow={id:string;time:string;price:number|null;volume:number|null;side:string;action:string};
type Payload={connected:boolean;notice:string;provider?:string;asOf?:string;volumeUnit?:string;bids:Level[];asks:Level[];trades:RecordRow[];orders:RecordRow[]};
export default function Level2Panel({symbol}:{symbol:string}){
 const feed=useLiveEndpoint<Payload>('/api/level2?symbol='+symbol),data=feed.data;
 return <div className="desk-level2"><h3>Level-2</h3><p>{t(data?.notice||feed.error||'正在核验授权行情连接…')}</p>{data?.connected&&<><small>{data.provider} · {data.asOf} · {data.volumeUnit}</small><table><thead><tr><th>{t('档位')}</th><th>{t('价格')}</th><th>{t('数量')}</th></tr></thead><tbody>{[...data.asks].reverse().map((p,i)=><tr key={'ask'+i}><td>{t('卖')}{data.asks.length-i}</td><td>{p.price.toFixed(2)}</td><td>{p.volume}</td></tr>)}{data.bids.map((p,i)=><tr key={'bid'+i}><td>{t('买')}{i+1}</td><td>{p.price.toFixed(2)}</td><td>{p.volume}</td></tr>)}</tbody></table>{(['trades','orders'] as const).map(k=><details key={k}><summary>{t(k==='trades'?'逐笔成交':'逐笔委托')} ({data[k].length})</summary><table><tbody>{data[k].map((r,i)=><tr key={r.id||i}><td>{r.time}</td><td>{r.price?.toFixed(2)??'—'}</td><td>{r.volume??'—'}</td><td>{r.side} {r.action}</td></tr>)}</tbody></table></details>)}</>}<button className="outline-button" onClick={feed.refresh}>{t('重新核验连接')}</button></div>;
}
