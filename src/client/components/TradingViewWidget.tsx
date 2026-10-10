import { useEffect, useRef } from 'react';
import { CATALOG } from '../../shared/catalog';

type Kind='advanced'|'tape';
export default function TradingViewWidget({kind='advanced',symbol='NVDA'}:{kind?:Kind;symbol?:string}){
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
  if(kind==='tape'){
   script.src='https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
   script.text=JSON.stringify({
    symbols:[
     {proName:'FOREXCOM:SPXUSD',title:'S&P 500'},{proName:'NASDAQ:NDX',title:'Nasdaq 100'},
     {proName:'TVC:DXY',title:'Dollar Index'},{proName:'TVC:GOLD',title:'Gold'},
     {proName:'FX_IDC:USDCNY',title:'USD/CNY'},{proName:'NASDAQ:NVDA',title:'NVIDIA'}
    ],
    showSymbolLogo:false,isTransparent:true,displayMode:'adaptive',colorTheme:'dark',locale:'en'
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
 },[kind,symbol]);
 return <div className={'tv-widget-shell '+(kind==='tape'?'tv-widget-tape':'tv-widget-chart')}>
  <div ref={ref} className="tradingview-widget-container tv-widget-inner"/>
  <a className="tv-attribution" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Charts by TradingView</a>
 </div>;
}
