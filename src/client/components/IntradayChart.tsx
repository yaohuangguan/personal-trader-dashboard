import {t as uiText} from '../preferences';
import {usePreferences} from '../preferences';
import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle, type UTCTimestamp, type Time } from 'lightweight-charts';
import type { IntradayPayload } from '../../shared/desk-types';

export default function IntradayChart({ data }: { data: IntradayPayload }) {
  const display=usePreferences();
  const element = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(data.points.at(-1));
  useEffect(() => {
    if (!element.current || !data.points.length) return;
    setHover(data.points.at(-1));
    const root = element.current;
    const clockFormatter=new Intl.DateTimeFormat(display.locale,{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
    const beijingClock=(time:Time)=>typeof time==='number'?clockFormatter.format(new Date(time*1000)):String(time);
    const chart = createChart(root, {
      width: root.clientWidth, height: root.clientWidth < 600 ? 310 : 425,
      layout: { background: { type: ColorType.Solid, color: '#0c0c0d' }, textColor: '#85858c', fontSize: Math.round(display.fontSize*.82) },
      grid: { vertLines: { visible: false }, horzLines: { color: '#202023' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.24 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, lockVisibleTimeRangeOnResize: true, tickMarkFormatter:beijingClock },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale:display.locale,timeFormatter:beijingClock },
    });
    const price = chart.addAreaSeries({ lineColor: '#dedee3', topColor: '#d0d0d019', bottomColor: '#d0d0d000', lineWidth: 2, priceLineVisible: false });
    price.setData(data.points.map(p => ({ time: p.time as UTCTimestamp, value: p.price })));
    if (data.previous && data.previous > 0) price.createPriceLine({ price: data.previous, lineStyle: LineStyle.Dashed, lineWidth: 1, color: '#73737c', axisLabelVisible: true, title: uiText('昨收') });
    const volume = chart.addHistogramSeries({ priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0.02 } });
    volume.setData(data.points.map((p, i) => ({ time: p.time as UTCTimestamp, value: p.volume, color: p.price >= (data.points[i - 1]?.price ?? data.previous ?? p.price) ? '#ee5b6780' : '#38b59c80' })));
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove(param => {
      if (typeof param.time === 'number') setHover(data.points.find(p => p.time === param.time) || data.points.at(-1));
      else setHover(data.points.at(-1));
    });
    const observer = new ResizeObserver(() => chart.applyOptions({ width: root.clientWidth }));
    observer.observe(root);
    return () => { observer.disconnect(); chart.remove(); };
  }, [data,display]);
  return <div className="intraday-chart"><div className="intraday-legend"><span>{uiText(data.date)}</span><b>{uiText(hover?.clock || '—')}</b><span>{uiText("价格")}<strong>{uiText(hover?.price.toFixed(2) || '—')}</strong></span><small>{uiText("北京时间 · 公开分钟快照")}</small></div><div ref={element} data-testid="intraday-pane" /></div>;
}
