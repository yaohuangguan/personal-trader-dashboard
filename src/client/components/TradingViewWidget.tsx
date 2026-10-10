import { useEffect, useRef } from 'react';
import { CATALOG } from '../../shared/catalog';

type Kind='advanced'|'tape'|'quotes';
export default function TradingViewWidget({kind='advanced',symbol='NVDA',symbols=[]}:{kind?:Kind;symbol?:string;symbols?:string[]}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const holder=ref.current;if(!holder)return;
  const inner=document.createElement('div');inner.className='tradingview-widget-container__widget';
  inner.style.height='100%';inner.style.width='100%';
  holder.replaceChildren(inner);
  const script=document.createElement('script');
  script.async=true;script.type='text/javascript';
  const known=CATALOG.find(x=>x.symbol===symbol);
  const safe=/^[A-Z0-9.^-]{1,18}$/.test(symbol)?symbol:'NVDA';
  const tvSymbol=safe.endsWith('.SH')?'SSE:'+safe.slice(0,-3):safe.endsWith('.SZ')?'SZSE:'+safe.slice(0,-3):((known?.exchange==='NYSE'?'NYSE':'NASDAQ')+':'+safe);
  const toTv=(raw:string)=>{
   const ticker=/^[A-Z0-9.^-]{1,18}$/.test(raw)?raw:'NVDA';
   const company=CATALOG.find(x=>x.symbol===ticker);
   if(ticker.endsWith('.SH'))return 'SSE:'+ticker.slice(0,-3);
   if(ticker.endsWith('.SZ'))return 'SZSE:'+ticker.slice(0,-3);
   if(company?.exchange==='NYSE')return 'NYSE:'+ticker;
   return 'NASDAQ:'+ticker;
  };
  if(kind==='tape'){
   script.src='https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
   script.text=JSON.stringify({
    symbols:[
     {proName:'FOREXCOM:SPXUSD',title:'S&P 500'},{proName:'NASDAQ:QQQ',title:'Nasdaq 100 ETF'},
     {proName:'TVC:GOLD',title:'Gold'},{proName:'NASDAQ:AAPL',title:'Apple'},
     {proName:'FX_IDC:USDCNY',title:'USD/CNY'},{proName:'NASDAQ:NVDA',title:'NVIDIA'}
    ],
    showSymbolLogo:false,isTransparent:false,displayMode:'adaptive',colorTheme:'dark',locale:'en'
   });
  }else if(kind==='quotes'){
   script.src='https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js';
   script.text=JSON.stringify({
    title:'Watchlist · 参考报价',width:'100%',height:'100%',
    locale:'en',showSymbolLogo:false,colorTheme:'dark',
    symbolsGroups:[{name:'Personal Focus',symbols:symbols.slice(0,10).map(s=>({
     name:toTv(s),displayName:CATALOG.find(x=>x.symbol===s)?.name||s
    }))}]
   });
  }else{
   script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
   script.text=JSON.stringify({
    autosize:true,symbol:tvSymbol,interval:'D',timezone:'exchange',theme:'dark',
    style:'1',locale:'en',withdateranges:true,hide_side_toolbar:true,
    allow_symbol_change:false,save_image:false,details:false,
    calendar:false,support_host:'https://www.tradingview.com'
   });
  }
  holder.appendChild(script);
  return ()=>{holder.replaceChildren();};
 },[kind,symbol,symbols.join('|')]);
 return <div className={'tv-widget-shell '+(kind==='tape'?'tv-widget-tape':kind==='quotes'?'tv-widget-quotes':'tv-widget-chart')}>
  <div ref={ref} className="tradingview-widget-container tv-widget-inner"/>
  <span className="tv-attribution">Chart data &amp; widgets by TradingView · third-party reference</span>
 </div>;
}
