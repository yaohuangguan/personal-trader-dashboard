export const CLASSIC_MA=[5,13,20,30,60,120,144,250];
export const FIBONACCI_MA=[5,13,21,34,55,89,144,233];
export type MASystem='classic'|'fibonacci'|'custom';
export function maPeriods(value?:number[]){return value===undefined?[...CLASSIC_MA]:[...new Set(value.filter(n=>Number.isInteger(n)&&n>=1&&n<=500))].sort((a,b)=>a-b).slice(0,12);}
export function maSystem(p:number[]):MASystem{return JSON.stringify([...p].sort((a,b)=>a-b))===JSON.stringify(CLASSIC_MA)?'classic':JSON.stringify([...p].sort((a,b)=>a-b))===JSON.stringify(FIBONACCI_MA)?'fibonacci':'custom';}
export const maSystemName=(s:MASystem)=>s==='classic'?'经典':s==='fibonacci'?'斐波那契':'自定义';
export function maRole(p:number[],target:number){return p.length?p.reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a):target;}
export function parseMAPeriods(value:string|null){if(value===null)return undefined;const p=value.split(',').map(Number);if(p.length>12||p.some(n=>!Number.isInteger(n)||n<1||n>500)||new Set(p).size!==p.length)throw new Error('无效MA周期');return maPeriods(p);}
