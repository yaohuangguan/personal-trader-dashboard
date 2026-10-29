export type AuctionPoint={clock:string;sourceClock:string;price:number;volume:number;amount:number|null;indicative:boolean;observation?:boolean};
export type AuctionSegment={key:'open'|'close'|'after';label:string;points:AuctionPoint[];notice:string};
export const emptyAuctionSegments=():AuctionSegment[]=>[
 {key:'open',label:'开盘集合竞价 · 09:15–09:25',points:[],notice:'虚拟撮合不等于成交；未取得逐分钟参考价时只显示最终撮合结果。'},
 {key:'close',label:'收盘集合竞价 · 14:57–15:00',points:[],notice:'14:57–15:00为集合竞价；普通分时快照不能还原委托、撤单或未匹配量。'},
 {key:'after',label:'盘后固定价成交 · 15:05–15:30',points:[],notice:'与集合竞价分开统计；仅展示来源实际披露的成交样本。'},
];
/** Eastmoney f53 price, f56 lots, f57 CNY. Keep source time and logical match time. */
export function parseAuctionTrends(rows:string[]):AuctionSegment[]{
 const segments=emptyAuctionSegments();
 for(const row of rows){
  const f=row.split(','),clock=f[0]?.slice(11,16),price=Number(f[2]),volume=Number(f[5]),amount=Number(f[6]);
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(f[0]||'')||!Number.isFinite(price)||price<=0||!Number.isFinite(volume)||volume<0||!Number.isFinite(amount)||amount<0)continue;
  if(clock>='09:15'&&clock<='09:25')segments[0].points.push({clock,sourceClock:clock,price,volume,amount,indicative:true});
  // Final open match is published by this feed at 09:26; never use 09:31 continuous volume.
  else if(clock==='09:26'&&volume>0)segments[0].points.push({clock:'09:25',sourceClock:clock,price,volume,amount,indicative:false});
  else if(clock>='14:57'&&clock<='15:00')segments[1].points.push({clock,sourceClock:clock,price,volume,amount,indicative:clock!=='15:00'});
  else if(clock>='15:05'&&clock<='15:30'&&volume>0)segments[2].points.push({clock,sourceClock:clock,price,volume,amount,indicative:false});
 }return segments;
}
