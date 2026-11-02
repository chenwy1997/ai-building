import type {Audit} from './staged.ts';
export interface Resolution {decisions:Array<{issue:number;verdict:'confirmed'|'dismissed'|'uncertain';reason:string}>}
export const RESOLUTION_TASK=`你只复核检查器提出的每条意见，不修改模板，不再创造新意见。模板完整行的单位、格式、条件和定义共同生效。
confirmed=能指出现有约束之间的实质冲突或明确需求无法表达；dismissed=已被现有约束解决、只是偏好、意见自己承认自洽，或依赖未经规定的行为；uncertain=现有资料无法裁定。
单位元数据与文本示例内带相同单位不自动表示重复拼接，系统没有规定自动拼单位。optional空白表示未知/未填写，与明确填“无”表示已知没有可共存。文本允许多规格/工况时不必仅为统一类型改成number。条件字段依赖无条件字段是单向依赖，不等于循环。
核对意见引用是否覆盖了完整字段的约束。每条意见都必须有决定与简短依据，禁止通过关键词过滤或为了放行而否决；存在真实矛盾仍应confirmed。输出json {decisions:[{issue:从0开始的序号,verdict:confirmed|dismissed|uncertain,reason:依据}]}。`;
export function parseResolution(v:unknown,audit:Audit):Resolution{
 const r=v as Resolution;if(!r||!Array.isArray(r.decisions)||r.decisions.length!==audit.issues.length)throw new Error('裁决必须覆盖所有意见');const seen=new Set<number>();
 for(const d of r.decisions){if(!Number.isInteger(d.issue)||d.issue<0||d.issue>=audit.issues.length||seen.has(d.issue)||!['confirmed','dismissed','uncertain'].includes(d.verdict)||typeof d.reason!=='string'||!d.reason.trim())throw new Error('裁决项不合法');seen.add(d.issue);}return r;
}
export function unresolved(audit:Audit,resolution:Resolution){return resolution.decisions.filter(d=>d.verdict!=='dismissed').map(d=>({key:audit.issues[d.issue]!.key,reason:`${d.verdict}：${d.reason}；原意见：${audit.issues[d.issue]!.reason}`}));}
