import type {chartStudy} from '../shared/chart-study';
import type {PatternMark} from '../shared/pattern-marks';
/** Fixed box boundaries need one range on the wire; knownAt retains its causal discovery date. */
export function compactPatternRanges(marks:PatternMark[]){
 const boxes=new Map<string,{first:string;latest:PatternMark}>(),out:PatternMark[]=[];
 for(const m of marks){if(m.kind!=='box-range'||!m.range){out.push(m);continue;}const key=m.anchorTime||m.range.from,old=boxes.get(key);boxes.set(key,{first:old&&old.first<m.time?old.first:m.time,latest:old&&old.latest.time>m.time?old.latest:m});}
 for(const {first,latest} of boxes.values())out.push({...latest,knownAt:first});
 return out.sort((a,b)=>a.time.localeCompare(b.time)||b.priority-a.priority);
}
export function chartPayload(study:ReturnType<typeof chartStudy>){
 const {strategy:_strategy,...display}=study;
 return {...display,patternMarks:compactPatternRanges(display.patternMarks)};
}
