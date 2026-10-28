import type {IChartApi,ISeriesApi,LogicalRange,Time} from 'lightweight-charts';
import type {Candle} from '../../shared/types';
import {primaryPatternMarks,type PatternMark} from '../../shared/pattern-marks';
const NS='http://www.w3.org/2000/svg';
/** Annotations never enter the series autoscaler or change the chart's DOM height. */
export function chartPatternOverlay(element:HTMLDivElement,chart:IChartApi,series:ISeriesApi<'Candlestick'>,bars:Candle[],marks:PatternMark[],trades:Set<string>,light:boolean,translate:(s:string)=>string){
 const svg=document.createElementNS(NS,'svg');svg.classList.add('pattern-box-overlay');svg.setAttribute('aria-hidden','true');element.append(svg);
 const indices=new Map(bars.map((c,i)=>[c.time,i])),primaries=primaryPatternMarks(marks);
 const node=(tag:string,attrs:Record<string,string|number>)=>{const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el;};
 function update(range:LogicalRange|null){
  const width=element.clientWidth,height=element.clientHeight,axis=chart.priceScale('left').width(),plotWidth=width-axis;
  svg.replaceChildren();svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));
  if(plotWidth<80)return;
  const x=(time:string)=>{const value=chart.timeScale().timeToCoordinate(time as Time);return value===null?null:value+axis;};
  for(const mark of marks.filter(m=>m.range&&m.chartVisible!==false).slice(-3)){
   const box=mark.range!,x1=x(box.from),x2=x(box.to),y1=series.priceToCoordinate(box.high),y2=series.priceToCoordinate(box.low);
   if(x1===null||x2===null||y1===null||y2===null||x2<axis||x1>width)continue;
   svg.append(node('rect',{x:Math.max(axis,x1),y:Math.max(0,Math.min(y1,y2)),width:Math.max(0,Math.min(width,x2)-Math.max(axis,x1)),height:Math.min(height,Math.abs(y2-y1)),fill:'rgba(130,155,180,.025)',stroke:'#829bb4','stroke-width':.65,'stroke-dasharray':'4 4'}));
  }
  const occupied:{x:number;y:number;w:number;h:number}[]=[],riskIndices:number[]=[],suppressed=new Set<string>();
  for(const time of trades){const index=indices.get(time);if(index===undefined)continue;const px=x(time),hi=series.priceToCoordinate(bars[index].high),lo=series.priceToCoordinate(bars[index].low);if(px===null||hi===null||lo===null)continue;occupied.push({x:px-18,y:hi-31,w:36,h:27},{x:px-18,y:lo+3,w:36,h:27});}
  for(const m of primaries){if(!m.kind.startsWith('stage-')||m.kind==='stage-turning')continue;const i=indices.get(m.time)!;if(riskIndices.some(old=>i-old<10))suppressed.add(m.time);else riskIndices.push(i);}
  const visible=primaries.filter(m=>(!suppressed.has(m.time)||m.time===bars.at(-1)?.time)&&(!range||((indices.get(m.time)??-1)>=range.from&&(indices.get(m.time)??-1)<=range.to)));
  let count=0;
  for(const mark of visible.sort((a,b)=>Number(b.time===bars.at(-1)?.time)-Number(a.time===bars.at(-1)?.time)||b.priority-a.priority||b.time.localeCompare(a.time))){
   if(count>=6)break;
   const index=indices.get(mark.time)!,bar=bars[index],px=x(mark.time),high=series.priceToCoordinate(bar.high),low=series.priceToCoordinate(bar.low);
   if(px===null||high===null||low===null||px<axis+3||px>width-3)continue;
   const label=translate(mark.label)+(mark.provisional?' · '+translate('待收盘'):''),font=11.5,labelWidth=Math.min(plotWidth-10,[...label].reduce((n,c)=>n+(/[\u2e80-\u9fff]/.test(c)?font:font*.6),0)+10),lx=Math.max(axis+3,Math.min(width-labelWidth-3,px-labelWidth/2));
   const above=mark.position==='above',ys=above?[high-27,high-57,low+11,low+41]:[low+11,low+41,high-27,high-57];
   const ly=ys.find(y=>y>=4&&y+19<height-4&&!occupied.some(o=>lx<o.x+o.w+8&&lx+labelWidth+8>o.x&&y<o.y+o.h+5&&y+24>o.y));
   if(ly===undefined)continue;
   const colour=mark.direction==='bullish'?(light?'#bc2939':'#f04a55'):mark.direction==='bearish'?(light?'#087c62':'#28cdb6'):(light?'#65707c':'#9ba0aa');
   const g=node('g',{'data-pattern-time':mark.time,'data-pattern-kind':mark.kind});
   g.append(node('circle',{cx:px,cy:Math.max(3,Math.min(height-3,ly<high?high-5:low+5)),r:2.2,fill:colour}));
   g.append(node('rect',{x:lx,y:ly,width:labelWidth,height:19,rx:3,fill:light?'#fffffff0':'#0c0c0de8'}));
   const text=node('text',{x:lx+5,y:ly+13.5,fill:colour,'font-size':font,'font-family':'Inter, Microsoft YaHei, sans-serif'});text.textContent=label;g.append(text);svg.append(g);
   occupied.push({x:lx,y:ly,w:labelWidth,h:19});count++;
  }
 }
 return {update,destroy:()=>svg.remove()};
}
