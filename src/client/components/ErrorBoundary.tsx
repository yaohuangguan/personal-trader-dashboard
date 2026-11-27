import {Component,type ErrorInfo,type ReactNode} from 'react';
import {RefreshCw,TriangleAlert} from 'lucide-react';
import {t} from '../preferences';

type Props={children:ReactNode;label?:string;resetKey?:unknown;compact?:boolean;fallback?:(retry:()=>void,error:Error)=>ReactNode};
type State={error:Error|null;key:unknown};

/** Keeps one failing panel from blanking the whole page; resets on retry or when resetKey (symbol / view) changes. */
export default class ErrorBoundary extends Component<Props,State>{
 state:State={error:null,key:this.props.resetKey};
 static getDerivedStateFromError(error:Error){return {error};}
 static getDerivedStateFromProps(props:Props,state:State):Partial<State>|null{
  return Object.is(props.resetKey,state.key)?null:{error:null,key:props.resetKey};
 }
 componentDidCatch(error:Error,info:ErrorInfo){console.error('[atlas] panel failed',this.props.label||'',error,info.componentStack);}
 retry=()=>this.setState({error:null});
 render(){
  const {error}=this.state;
  if(!error)return this.props.children;
  if(this.props.fallback)return this.props.fallback(this.retry,error);
  return <div className={'panel-error'+(this.props.compact?' is-compact':'')} role="alert">
   <TriangleAlert size={18}/>
   <div><b>{t(this.props.label?this.props.label+'暂时无法显示':'此面板暂时无法显示')}</b><small>{t('其他功能不受影响，可重试；问题持续时请刷新页面。')}</small></div>
   <button type="button" onClick={this.retry}><RefreshCw size={14}/>{t('重试')}</button>
  </div>;
 }
}
