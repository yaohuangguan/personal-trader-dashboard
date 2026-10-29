import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),target=new URL('mobile/assets/chart_engine.js',root);
const output=await build({entryPoints:[new URL('src/shared/local-study.ts',root).pathname.replace(/^\/(.:)/,'$1')],bundle:true,format:'iife',globalName:'AtlasLocalStudy',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'none'});
const text=output.outputFiles[0].text;
if(process.argv.includes('--check')){if(await readFile(target,'utf8')!==text)throw Error('Run npm run build:mobile-engine before shipping changed chart rules');}
else{await mkdir(new URL('mobile/assets/',root),{recursive:true});await writeFile(target,text);}
console.log('iOS shared study engine: '+Buffer.byteLength(text)+' bytes');
