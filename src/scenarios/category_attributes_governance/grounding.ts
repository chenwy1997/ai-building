import type {Plan} from './staged.ts';
export const RELATIONS=['dimension','sample_value','analogy','unrelated','uncertain'] as const;
export interface Grounding {rejectedLinks?:Array<{key:string;ref:string;quote:string;reason:string}>;items:Array<{key:string;links:Array<{ref:string;relation:typeof RELATIONS[number];quote:string;reason:string}>;knowledgeNote:string}>}
export const GROUNDING_TASK=`只判断原始资料与已规划属性的支持关系，不生成模板，不删属性，不填写商品实值。
逐维度判断资料谈论的对象、属性含义、量纲、条件是否相符，而非只看字段名。商品自身的品牌不能直接证明适配对象品牌；整机性能不能直接证明配件性能；销售规格串不等于几何尺寸；标题列出多个型号不能无条件证明全部适配。不要靠关键词规则代替语义。
relation：dimension=同一对象上直接体现这个属性维度，可支持维度存在，但不能据此泛化必填性、枚举全集或数值；sample_value=只支持某样本取值，不能支持此规划定义；analogy=其他对象的类比；unrelated=不相干或对象错误；uncertain=无法确认。
只有字段值本身能够说明目标属性含义，才判dimension；字段名、所在栏目或数据结构仅帮助定位，不能替代内容。检查去掉字段名后，引用值是否仍包含目标信息：只有数量、占位符或泛称时，不能补想出附件构成、几何尺寸或兼容清单。材料名可以是骨架/绝缘材料，不自动证明发热原理。dimension的reason必须说明引用值实际表达了什么目标信息，不能仅写“该字段可体现”。没有明确正证据就记uncertain或unrelated并用K补充，不凑支持。
每个维度选最多2条最相关资料判断；不必凑引用，没有支持时links=[]并说明行业知识补充或待核验。不能用类比代替直接证据，也不能因缺证据删除行业通用维度。quote必须是该R编号字段值内逐字存在的片段，reason简短说明对象和语义关系。仅dimension关系可进入该属性外部引用白名单，其他关系只存评估记录。`;
export function parseGrounding(value:unknown,plan:Plan,documents:Array<{fields:string[][]}>):Grounding{
 const g=structuredClone(value) as Grounding,keys=new Set(plan.dimensions.map(d=>d.key)),seen=new Set<string>(),fields=new Map(documents.flatMap(d=>d.fields.map(f=>[f[0]!,f[2]!] as const)));
 if(!g||!Array.isArray(g.items)||g.items.length!==keys.size)throw new Error('证据评估必须覆盖全部维度');
 g.rejectedLinks=[];
 for(const item of g.items){if(!keys.has(item.key)||seen.has(item.key)||!Array.isArray(item.links)||item.links.length>2||typeof item.knowledgeNote!=='string')throw new Error('证据评估维度错误');seen.add(item.key);const refs=new Set<string>();
  item.links=item.links.filter(link=>{const source=fields.get(link.ref);if(typeof link.ref!=='string'||!RELATIONS.includes(link.relation)||typeof link.quote!=='string'||typeof link.reason!=='string'||!link.reason.trim())throw new Error('证据关系结构错误');if(source===undefined||refs.has(link.ref)||!link.quote.trim()||!source.includes(link.quote)){g.rejectedLinks!.push({key:item.key,ref:link.ref,quote:link.quote,reason:'字段不存在、重复或引用不属于该字段；隔离，不猜测替换'});return false;}refs.add(link.ref);return true;});
  if(!item.links.some(l=>l.relation==='dimension')&&!item.knowledgeNote.trim()&&g.rejectedLinks.some(l=>l.key===item.key))item.knowledgeNote='直接引用未通过定位校验，须作为K知识候选或补证，不能视为外部已验证';
  if(!item.links.some(l=>l.relation==='dimension')&&!item.knowledgeNote.trim())throw new Error('缺直接依据时须注明知识来源/待核验');
 }return g;
}
export function evidenceAllowlist(g:Grounding):Record<string,string[]>{return Object.fromEntries(g.items.map(i=>[i.key,['K',...i.links.filter(l=>l.relation==='dimension').map(l=>l.ref)]]));}
export function checkAttributeReferences(value:unknown,allowed:Record<string,string[]>){
 const v=value as {upsert?:Array<{k:string;e:string[]}>};if(!v||!Array.isArray(v.upsert))throw new Error('属性数组缺失');
 for(const a of v.upsert){if(!a||!Array.isArray(a.e)||!allowed[a.k]||a.e.some(r=>!allowed[a.k]!.includes(r)))throw new Error('属性引用超出本维度已评估白名单：'+String(a?.k));}return value;
}
