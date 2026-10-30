export type EarningsSort='profitGrowth'|'revenueGrowth'|'profit'|'revenue'|'disclosed';
export type EarningsRow={symbol:string;name:string;industry:string;period:string;disclosed:string;revenue:number|null;profit:number|null;revenueGrowth:number|null;profitGrowth:number|null;eps:number|null;roe:number|null;cashPerShare:number|null};
export type EarningsPayload={items:EarningsRow[];period:string;periods:string[];page:number;pageSize:number;pages:number;total:number;sort:EarningsSort;order:'asc'|'desc';query:string;source:string;sourceUrl:string;fetchedAt:string;notice:string};
export const earningsSorts:Record<EarningsSort,string>={profitGrowth:'归母净利同比',revenueGrowth:'营收同比',profit:'归母净利润',revenue:'营业收入',disclosed:'披露日期'};
export function reportLabel(period:string){const year=period.slice(0,4),quarter=period.slice(5);return year+({'03-31':' 一季报','06-30':' 中报','09-30':' 三季报','12-31':' 年报'}[quarter]||'');}
export function reportPeriods(now=new Date(),count=8){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),year=Number(today.slice(0,4)),result:string[]=[];
 for(let y=year;y>=year-3;y--)for(const d of ['12-31','09-30','06-30','03-31'])if(y+'-'+d<=today&&result.length<count)result.push(y+'-'+d);
 return result;
}
const numeric=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()!==''&&v!=='-'&&Number.isFinite(Number(v))?Number(v):null;
export function earningsRow(r:Record<string,unknown>):EarningsRow|null{
 const symbol=String(r.SECUCODE||''),period=String(r.REPORTDATE||'').slice(0,10),disclosed=String(r.NOTICE_DATE||'').slice(0,10);
 if(!/^\d{6}\.(SH|SZ|BJ)$/.test(symbol)||!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period)||!/^\d{4}-\d{2}-\d{2}$/.test(disclosed))return null;
 const clean=(v:unknown)=>String(v??'').replace(/<[^>]*>/g,'').trim();
 return {symbol,name:clean(r.SECURITY_NAME_ABBR),industry:clean(r.BOARD_NAME),period,disclosed,revenue:numeric(r.TOTAL_OPERATE_INCOME),profit:numeric(r.PARENT_NETPROFIT),revenueGrowth:numeric(r.YSTZ),profitGrowth:numeric(r.SJLTZ),eps:numeric(r.BASIC_EPS),roe:numeric(r.WEIGHTAVG_ROE),cashPerShare:numeric(r.MGJYXJJE)};
}
