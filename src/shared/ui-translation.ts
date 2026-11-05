type Dictionary=Record<string,string>;
const caches=new WeakMap<Dictionary,Array<{pattern:RegExp;names:string[];translation:string}>>();
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Exact UI keys and explicitly catalogued templates; never substring-translate source content. */
export function translateUI(value:string,dictionary:Dictionary):string{
 if(Object.hasOwn(dictionary,value))return dictionary[value];
 let templates=caches.get(dictionary);
 if(!templates){
  templates=[];
  for(const [key,translation] of Object.entries(dictionary)){
   if(!/\{\w+\}/.test(key))continue;
   const names:string[]=[],parts=key.split(/(\{\w+\})/).map(part=>{
    if(/^\{\w+\}$/.test(part)){names.push(part.slice(1,-1));return '(.+?)';}
    return escape(part);
   });
   templates.push({pattern:new RegExp('^'+parts.join('')+'$'),names,translation});
  }
  caches.set(dictionary,templates);
 }
 for(const template of templates){
  const match=template.pattern.exec(value);if(!match)continue;
  return template.translation.replace(/\{(\w+)\}/g,(_token,name:string)=>{
   const captured=match[template.names.indexOf(name)+1];
   return Object.hasOwn(dictionary,captured)?dictionary[captured]:captured;
  });
 }
 const amount=/^([+−-]?\d+(?:\.\d+)?)(万|亿)(手|股|元)?$/.exec(value);
 if(amount){const multiplier=amount[2]==='亿'?100:0.01,number=Number(amount[1].replace('−','-'))*multiplier;return Number(number.toFixed(3))+'M'+(amount[3]==='手'?' lots':amount[3]==='股'?' shares':amount[3]==='元'?' CNY':'');}
 return value;
}
