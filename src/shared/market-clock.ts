export const isUSStock=(symbol='')=>/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/.test(symbol);
export const supportedStock=(symbol:string)=>/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)||isUSStock(symbol);

/** Exchange-local dates, including New York daylight saving changes. */
export function marketClock(now=new Date(),symbol=''){
 const us=isUSStock(symbol),timeZone=us?'America/New_York':'Asia/Shanghai';
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(key:string)=>parts.find(p=>p.type===key)!.value;
 return {date:`${get('year')}-${get('month')}-${get('day')}`,minute:Number(get('hour'))*60+Number(get('minute')),close:us?960:900,timeZone};
}

/** Convert an upstream wall-clock timestamp without assuming a fixed UTC offset. */
export function newYorkTimestamp(value:string){
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return null;
 const utc=Date.parse(value.replace(' ','T')+'Z');
 if(!Number.isFinite(utc))return null;
 const local=marketClock(new Date(utc),'AAPL'),reference=Date.parse(local.date+'T'+String(Math.floor(local.minute/60)).padStart(2,'0')+':'+String(local.minute%60).padStart(2,'0')+':'+value.slice(-2)+'Z');
 const instant=new Date(utc+(utc-reference));
 const check=marketClock(instant,'AAPL');
 if(check.date!==value.slice(0,10)||check.minute!==Number(value.slice(11,13))*60+Number(value.slice(14,16)))return null;
 return instant.toISOString();
}
