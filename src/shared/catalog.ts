import type { SearchItem } from './types';

export const SECTORS = [
  { id: 'ai-hardware', name: 'AI 硬件', en: 'AI Infrastructure', words: ['NVIDIA','NVDA','GPU','chip','semiconductor','memory','HBM','optical','data center','算力','芯片','光模块','存储','半导体','英伟达'], tickers: ['NVDA','MU','300308.SZ','300502.SZ'] },
  { id: 'ai-software', name: 'AI 软件 / 应用', en: 'AI Applications', words: ['OpenAI','Anthropic','Agent','artificial intelligence','AI software','enterprise AI','大模型','人工智能','智能体','AI应用'], tickers: ['MSFT','GOOGL','PLTR'] },
  { id: 'robotics', name: '机器人', en: 'Robotics', words: ['robot','humanoid','automation','机器人','人形','特斯拉机器人'], tickers: ['TSLA','002050.SZ','601689.SH'] },
  { id: 'biotech', name: '创新药', en: 'Innovative Medicine', words: ['FDA','clinical trial','drug approval','biotech','GLP-1','临床','创新药','新药','药物'], tickers: ['LLY','600276.SH'] },
  { id: 'space', name: '商业航天', en: 'Commercial Space', words: ['SpaceX','rocket','satellite','launch','space industry','商业航天','卫星','火箭','发射'], tickers: ['RKLB','ASTS'] },
  { id: 'energy', name: '储能 / 新能源', en: 'Energy Transition', words: ['battery','solar','energy storage','grid','lithium','储能','新能源','锂电','光伏','电网'], tickers: ['TSLA','300750.SZ','002594.SZ'] },
  { id: 'consumer', name: '大消费', en: 'Consumer', words: ['consumer spending','retail sales','luxury','consumption','消费','零售','白酒','旅游'], tickers: ['AAPL','600519.SH','PDD'] }
] as const;

export const CATALOG: SearchItem[] = [
  ['NVDA','NVIDIA','NASDAQ','AI 硬件'], ['AAPL','Apple','NASDAQ','消费电子'],
  ['MSFT','Microsoft','NASDAQ','AI 软件'],['GOOGL','Alphabet','NASDAQ','AI 软件'],
  ['AMZN','Amazon','NASDAQ','云计算'],['META','Meta Platforms','NASDAQ','AI 软件'],
  ['TSLA','Tesla','NASDAQ','机器人 / 新能源'],['AMD','AMD','NASDAQ','AI 硬件'],
  ['MU','Micron Technology','NASDAQ','存储'],['AVGO','Broadcom','NASDAQ','AI 硬件'],
  ['PLTR','Palantir','NYSE','AI 应用'],['RKLB','Rocket Lab','NASDAQ','商业航天'],
  ['ASTS','AST SpaceMobile','NASDAQ','商业航天'],['LLY','Eli Lilly','NYSE','创新药'],
  ['PDD','PDD Holdings','NASDAQ','大消费'],['QQQ','Invesco QQQ','NASDAQ','ETF'],
  ['SPY','SPDR S&P 500','NYSE','ETF'],['SMH','VanEck Semiconductor','NASDAQ','ETF'],
  ['300308.SZ','中际旭创','SZSE','AI 光模块'],['300502.SZ','新易盛','SZSE','AI 光模块'],
  ['300394.SZ','天孚通信','SZSE','AI 光模块'],['688498.SH','源杰科技','SSE','半导体'],
  ['688047.SH','龙芯中科','SSE','芯片'],['688256.SH','寒武纪','SSE','AI 芯片'],
  ['603986.SH','兆易创新','SSE','存储'],['002371.SZ','北方华创','SZSE','半导体设备'],
  ['688012.SH','中微公司','SSE','半导体设备'],['300545.SZ','联得装备','SZSE','先进封装'],
  ['002475.SZ','立讯精密','SZSE','消费电子'],['002050.SZ','三花智控','SZSE','机器人'],
  ['601689.SH','拓普集团','SSE','机器人'],['688017.SH','绿的谐波','SSE','机器人'],
  ['300124.SZ','汇川技术','SZSE','机器人'],['600276.SH','恒瑞医药','SSE','创新药'],
  ['300750.SZ','宁德时代','SZSE','新能源'],['002594.SZ','比亚迪','SZSE','新能源'],
  ['600519.SH','贵州茅台','SSE','大消费'],['000001.SZ','平安银行','SZSE','金融']
].map(([symbol,name,exchange,sector]) => ({symbol,name,exchange,sector}));

export const DEFAULT_WATCHLIST = ['NVDA','MU','300308.SZ','300502.SZ','AAPL','TSLA','300545.SZ'];
export const NEWS_CATEGORIES = [
  {id:'all', name:'全部情报'}, {id:'world',name:'全球要闻'}, {id:'macro',name:'宏观政策'},
  ...SECTORS.map(s=>({id:s.id,name:s.name}))
];
export function normalizeSymbol(raw:string):string {
  const input = raw.toUpperCase().trim();
  if (/^\d{6}$/.test(input)) return input + (input.startsWith('6') || input.startsWith('9') ? '.SH' : '.SZ');
  return input.replace(/\.SS$/, '.SH');
}
export function searchLocal(query:string, max=12): SearchItem[] {
  const q = query.trim().toLowerCase(); if (!q) return CATALOG.slice(0,max);
  const results = CATALOG.filter(x=>[x.name,x.symbol,x.sector].some(y=>y?.toLowerCase().includes(q)));
  const symbol = normalizeSymbol(query);
  if (/^[A-Z0-9^.-]{1,18}$/.test(symbol) && !results.some(x=>x.symbol===symbol))
    results.push({symbol,name:'自定义代码 · 尝试加载行情',exchange:/\.(SH|SZ)$/.test(symbol)?'CN':'US'});
  return results.slice(0,max);
}
