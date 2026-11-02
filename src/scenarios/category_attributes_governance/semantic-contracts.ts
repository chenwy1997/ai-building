import type {Attribute} from './types.ts';
import {parseAudit} from './staged.ts';

const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('需要对象');return v as Record<string,unknown>;};
const nonempty=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
export interface Need {id:string;dimension:string;object:string;scope:'intrinsic'|'declared_capability'|'included_configuration';meaning:string;purpose:string}
export interface Needs {needs:Need[];applicationContext:Array<{name:string;reason:string}>;gaps:string[]}
export function parseNeeds(v:unknown):Needs{
 const x=object(v);if(!Array.isArray(x.needs)||!x.needs.length||x.needs.length>20||!strings(x.gaps))throw new Error('needs为1~20项，gaps为字符串数组');
 if(!Array.isArray(x.applicationContext)||x.applicationContext.some(c=>!c||typeof c!=='object'||!nonempty(c.name)||!nonempty(c.reason)))throw new Error('applicationContext必须为name/reason对象数组');
 const seen=new Set<string>();for(const n of x.needs){const a=object(n);if(!['id','dimension','object','meaning','purpose'].every(k=>nonempty(a[k]))||seen.has(String(a.id))||!['intrinsic','declared_capability','included_configuration'].includes(String(a.scope)))throw new Error('需求字段必须非空、scope合法且id唯一');seen.add(String(a.id));}
 return x as unknown as Needs;
}
export interface Claim {key:string;name:string;meaning:string;ref:string;quote:string;sourceTitle:string;sourceField:string;sourceValue:string}
export interface ClaimVerdict {key:string;ref:string;verdict:'supported'|'unsupported'|'uncertain';reason:string}
export function parseClaimVerdicts(v:unknown,claims:Claim[]):{checks:ClaimVerdict[]}{
 const x=object(v);if(!Array.isArray(x.checks)||x.checks.length!==claims.length)throw new Error('checks必须逐一覆盖全部key/ref配对');
 const expected=new Set(claims.map(c=>JSON.stringify([c.key,c.ref]))),seen=new Set<string>();
 for(const c of x.checks){const a=object(c),id=JSON.stringify([a.key,a.ref]);if(!expected.has(id)||seen.has(id)||!['supported','unsupported','uncertain'].includes(String(a.verdict))||!nonempty(a.reason))throw new Error('证据核对必须逐一覆盖key/ref，verdict为supported|unsupported|uncertain，reason非空');seen.add(id);}
 return x as unknown as {checks:ClaimVerdict[]};
}
export function verifiedAllowlist(keys:string[],checks:ClaimVerdict[]){return Object.fromEntries(keys.map(k=>[k,['K',...checks.filter(c=>c.key===k&&c.verdict==='supported').map(c=>c.ref)]]));}
export interface Coverage {need:string;keys:string[];verdict:'covered'|'missing'|'partial'|'not_applicable'|'uncertain';reason:string}
export interface SemanticAudit {coverage:Coverage[];rows:Array<{key:string;nameMeaning:string;definitionMeaning:string;verdict:'pass'|'revise'|'uncertain';reason:string}>;issues:Array<{key:string;field:'name'|'type'|'requirement'|'unit'|'options'|'condition'|'description'|'format';quote:string;reason:string}>;gaps:string[]}
export function parseSemanticAudit(v:unknown,attrs:Attribute[],needs:Needs):SemanticAudit{
 const x=object(v),wanted=new Set(needs.needs.map(n=>n.id)),keys=new Set(attrs.map(a=>a[0]));
 if(!Array.isArray(x.coverage)||x.coverage.length!==wanted.size||!Array.isArray(x.rows)||x.rows.length!==keys.size||!Array.isArray(x.issues)||!strings(x.gaps))throw new Error('coverage覆盖所有需求，rows覆盖所有属性，issues与gaps必须为数组');
 const covered=new Set<string>(),seen=new Set<string>();
 for(const v of x.coverage){const c=object(v);if(typeof c.need!=='string'||!wanted.has(c.need)||covered.has(c.need)||!strings(c.keys)||new Set(c.keys).size!==c.keys.length||c.keys.some(k=>!keys.has(k))||!['covered','missing','partial','not_applicable','uncertain'].includes(String(c.verdict))||!nonempty(c.reason))throw new Error('coverage需求id/keys/verdict/reason非法');
  if(c.verdict==='covered'&&!c.keys.length)throw new Error('covered必须对应至少一个现有属性');if(c.verdict==='missing'&&c.keys.length)throw new Error('missing必须keys=[]；已有但不完整用partial');covered.add(c.need);
 }
 for(const v of x.rows){const r=object(v);if(typeof r.key!=='string'||!keys.has(r.key)||seen.has(r.key)||!['pass','revise','uncertain'].includes(String(r.verdict))||!nonempty(r.reason)||!nonempty(r.nameMeaning)||!nonempty(r.definitionMeaning))throw new Error('rows逐一覆盖key，须有nameMeaning/definitionMeaning、verdict及reason');seen.add(r.key);}
 parseAudit({checkedKeys:[...seen],issues:x.issues,knowledgeGaps:x.gaps},attrs);
 const result=x as unknown as SemanticAudit;
 for(const r of result.rows)if(r.verdict==='revise'&&!result.issues.some(i=>i.key===r.key)&&!result.coverage.some(c=>c.keys.includes(r.key)&&['partial','uncertain'].includes(c.verdict)))throw new Error(`${r.key}标记revise却没有精确issues或partial覆盖定位`);
 return result;
}
export function semanticFindings(a:SemanticAudit){return [
 ...a.coverage.filter(c=>!['covered','not_applicable'].includes(c.verdict)).map(c=>({key:'need:'+c.need,reason:`${c.verdict}: ${c.reason}`})),
 ...a.rows.filter(r=>r.verdict!=='pass').map(r=>({key:r.key,reason:`${r.verdict}: ${r.reason}`})),
 ...a.issues.map(i=>({key:i.key,reason:i.reason}))
];}
/** Passing checks are already resolved; keep all actionable findings and their independent requirements. */
export function repairFeedback(a:SemanticAudit,needs:Needs){
 const coverage=a.coverage.filter(c=>!['covered','not_applicable'].includes(c.verdict));
 return {coverage:coverage.map(c=>({...c,requirement:needs.needs.find(n=>n.id===c.need)!})),rows:a.rows.filter(r=>r.verdict!=='pass'),issues:a.issues,gaps:a.gaps,applicationContext:needs.applicationContext};
}

export interface SourceScope {documents:Array<{id:string;relation:'target'|'related'|'unrelated'|'uncertain';reason:string}>}
export function parseSourceScope(v:unknown,ids:string[]):SourceScope{
 const x=object(v);if(!Array.isArray(x.documents)||x.documents.length!==ids.length)throw new Error('资料范围判断必须覆盖全部D编号');const seen=new Set<string>();
 for(const item of x.documents){const d=object(item);if(typeof d.id!=='string'||!ids.includes(d.id)||seen.has(d.id)||!['target','related','unrelated','uncertain'].includes(String(d.relation))||!nonempty(d.reason))throw new Error('资料范围id/relation/reason非法');seen.add(d.id);}
 return x as unknown as SourceScope;
}
