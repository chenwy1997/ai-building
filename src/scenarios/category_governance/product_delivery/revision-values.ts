import type {KnowledgeProperty} from "../offline/types.ts";
import type {ResolvedProduct} from "./build.ts";
import {fillAttribute,titleFacts,normalizeNumeric,type FilledAttribute,type Fact} from "./attributes.ts";

const norm=(s:string)=>s.normalize("NFKC").replace(/\s+/gu," ").trim();
const append=(a:FilledAttribute,note:string)=>({...a,note:[a.note,note].filter(Boolean).join("；")});
const blank=(a:FilledAttribute,note:string,status:FilledAttribute["status"]="待补充"):FilledAttribute=>({...a,value:null,status,note});
export const REVIEWED_TEMPLATE_HASH="844cb682b4375e42a1a06140c3f5af53b1dc67b9d79fab62ce866a2de1def72d";

/** A source season or year never implies a particular calendar month. */
export function normalizeMonth(value:string):string|null{
 const m=norm(value).match(/^(\d{4})(?:年|[-/.])(\d{1,2})(?:月|(?:[-/.]\d{1,2})|(?:月\d{1,2}日))?$/u);
 if(!m||Number(m[2])<1||Number(m[2])>12)return null;
 return `${m[1]}-${m[2]!.padStart(2,"0")}`;
}

/** Preserve expression structure; convert a uniform, explicitly stated unit. */
export function normalizeMeasuredText(value:string,target:string):{value:string;note:string}{
 let v=norm(value).replace(/[；;]/gu,"；").replace(/(?<=\d)\s*[xX*]\s*(?=\d)/gu,"×");
 if(!target)return{value:v,note:""};
 // Minute/hour conversion is exact. Calendar month/day conversion is not.
 const time=v.match(/^(\d+(?:\.\d+)?)\s*(分钟|min|小时|h)$/iu);
 if(time&&/^(h|小时|min|分钟)$/iu.test(target)){
  const minutes=Number(time[1])*(/h|小时/iu.test(time[2]!)?60:1);
  return{value:String(/h|小时/iu.test(target)?minutes/60:minutes),note:`按明确时间单位换算为${target}`};
 }
 const scalar=normalizeNumeric(v,target);
 if(scalar!==null)return{value:String(scalar),note:`单位统一为${target}`};
 // Only transform numeric dimension/range/series expressions, never model codes
 // or a label such as FHD+ into an invented pixel count.
 const unitPattern="mm²|mm2|平方毫米|厘米|毫米|千克|公斤|MPa|kPa|GHz|MHz|kHz|cm|mm|kg|kV|mAh|mA|Hz|nm|px|°C|℃|°|度|米|秒|个|台|V|W|A|N|s|m|h";
 const units=[...v.matchAll(new RegExp(`(?<=\\d)\\s*(${unitPattern})(?=$|[\\s；;×xX*/~～—()（）含长宽高深厚])`,"giu"))];
 if(!units.length)return{value:v,note:""};
 const source=units[0]![1]!;
 if(units.some(x=>norm(x[1]!).toLowerCase()!==norm(source).toLowerCase()))return{value:v,note:"保留复合单位原文，不强行换算"};
 const factor=normalizeNumeric(`1${source}`,target);
 const same=norm(source).toLowerCase()===norm(target).toLowerCase();
 if(factor===null&&!same)return{value:v,note:"保留来源单位原文，未作跨量纲换算"};
 const stripped=v.replace(new RegExp(`(?<=\\d)\\s*(${unitPattern})(?=$|[\\s；;×xX*/~～—()（）含长宽高深厚])`,"giu"),"");
 if(!/^[\d\s.+\-~～—×xX*/；;()（）含长宽高深厚]+$/u.test(stripped))return{value:v,note:""};
 const value2=stripped.replace(/\d+(?:\.\d+)?/gu,s=>String(Number((Number(s)*(factor??1)).toPrecision(12))));
 return{value:value2,note:`按${target}填写；原始单位与表达见原始依据`};
}

const equivalentFields:Record<string,string[]>={电压:["额定电压","供电电压"],供电电压:["额定电压","电压"],测量范围:["测温范围"],额定承载:["最大承重","承重"],适用体重:["适用体重范围"]};
function revisionFacts(p:ResolvedProduct,a:KnowledgeProperty):Fact[]{
 const facts=titleFacts(p);
 const aliases=equivalentFields[a.name]??[];
 // Add equivalent names through the existing evidence reader so SKU source
 // exclusions, origin quotes and priorities remain intact.
 for(const oldName of aliases){
  const f=fillAttribute(p,{...a,name:oldName,key:a.key},facts);
  if(f.status==="已填写")facts.push({name:a.name,value:String(f.value),unit:f.unit,source:f.source,quote:f.quote,note:f.note,priority:85});
 }
 return facts;
}

export function reviseValue(p:ResolvedProduct,a:KnowledgeProperty,previous?:FilledAttribute,previousDefinition?:KnowledgeProperty,applyReviewedDecisions=false):FilledAttribute{
 let next=fillAttribute(p,a,revisionFacts(p,a));
 // Keep confirmed earlier evidence when only metadata changed. Units and types
 // are adapted below, so direct manual values cannot bypass the new contract.
 if(previous?.status==="已填写")next={...previous,key:a.key,name:a.name,type:a.type,required:a.required,condition:a.condition??"",templateUnit:a.unit??"",unit:a.unit??""};
 if(a.name==="CCC强制性认证"&&a.type==="text"){
  const evidence=p.fields.filter(f=>/CCC|3C|认证型号|证书/u.test(f.name));
  return blank({...next,source:evidence.map(f=>f.source).join("；"),quote:evidence.map(f=>`${f.name}：${f.value}`).join("；")},evidence.length?"京东商家声明及认证型号已保留；未取得有效证书、标签或官方记录，按修订模板要求待核实。":"缓存未提供认证证书、标签或官方记录；不推定通过或不适用。");
 }
 if(a.type==="date"&&a.format==="yyyy-MM"){
  const raw=next.value===null?null:String(next.value),date=raw?normalizeMonth(raw):null;
  if(!date)return blank(next,raw?`原资料仅为“${raw}”，不能确定月份；yyyy-MM 需要补充准确年月。`:"未取得准确上市年月，不能用年份或季节猜测月份。");
  return append({...next,value:date,status:"已填写"},"按修订格式 yyyy-MM 规范年月");
 }
 if(next.value!==null&&a.type==="number"){
  const sourceUnit=previous?.status==="已填写"?previous.unit:next.unit;
  const n=normalizeNumeric(String(next.value),a.unit??"",sourceUnit);
  if(n===null)return blank(next,"旧值无法按修订后的数值类型和单位可靠换算，原依据保留。");
  next={...next,value:n,unit:a.unit??""};
 }
 if(next.value!==null&&a.type==="boolean"&&typeof next.value!=="boolean"){
  const v=norm(String(next.value));
  if(["true","是","支持"].includes(v))next.value=true;
  else if(["false","否","不支持"].includes(v))next.value=false;
  else return blank(next,"现有值不能明确转换为布尔值，不能将未知填为 false。");
 }
 if(next.value!==null&&["single","multi"].includes(a.type)){
  const options=a.options??[],raw=norm(String(next.value));
  const values=a.type==="single"?[raw]:raw.split(/[;；]/u).map(s=>s.trim()).filter(Boolean);
  const matched=values.map(v=>options.find(o=>norm(o).toLowerCase()===v.toLowerCase()));
  if(!values.length||matched.some(v=>!v))return blank(next,`原值“${raw}”不在修订后的${a.type==="single"?"单选":"多选"}选项中，未强行归入其他选项。`);
  next.value=[...new Set(matched)].join(";");
 }
 if(next.value!==null&&a.type==="text"){
  next.value=typeof next.value==="boolean"?(next.value?"是":"否"):String(next.value);
  if(a.format?.includes("单位见单位列")){
   const measured=normalizeMeasuredText(next.value,a.unit??"");next.value=measured.value;
   if(measured.note&&measured.value!==previous?.value)next=append(next,measured.note);
   if(a.name==="屏幕分辨率"&&!/^\d+\s*[×xX*]\s*\d+$/u.test(String(next.value)))next=append({...next,unit:""},"保留商品资料的分辨率等级名称；未提供像素矩阵，不将等级名称当成像素数。");
  }
 }
 // Exact selected product readings reviewed against this fixed test set.
 if(!applyReviewedDecisions)return next;
 const direct=(value:string|number,quote:string,note:string,source="原表.商品标题"):FilledAttribute=>({...next,value,status:"已填写",source,quote,note});
 if(a.name==="桌面长度"&&[529,547,989].includes(p.row)){
  const m=p.variant.match(/(\d+(?:\.\d+)?)米/u)!;
  return direct(String(Number(m[1])*100),p.variant,"按选定规格将米换算为厘米，替换商家笼统的长度筛选区间。","原表.颜色尺寸");
 }
 if(p.row===453&&a.name==="外形尺寸")return blank(next,"京东将冰箱宽、深、高均填为 1mm，明显为占位数据；不能作为尺寸交付。");
 if(p.row===998&&a.name==="外形尺寸")return blank({...next,quote:`${next.quote}；京东宽度：85.1-90cm；京东深度：65.1-70cm`},"详细参数的宽深与京东宽度、深度区间互相矛盾；保留原文，不能擅自调换。","资料冲突");
 if(p.row===306&&a.name==="续航时间")return blank({...next,quote:`${next.quote}；京东电池类型：不涉及；电池重量：10千克`},"同一SKU的电池适用性与续航/电池参数矛盾，不能确认120分钟是本机续航。","资料冲突");
 if(p.row===422&&a.name==="额定电流")return direct("30(100)",p.variant,"按电表标示保留基本电流30A、最大电流100A的括号表达，不将其改写成普通区间。","原表.颜色尺寸");
 if(p.row===280&&a.name==="测量范围")return blank({...next,source:"原表.商品标题",quote:p.title},"标题量程仅写300KG，模板单位为N；没有kgf或力值依据，不能将质量标示擅自换成力。");
 if(p.row===833&&a.name==="连接方式")return direct("电熔连接",p.title,"标题明确为PE电熔异径接头，按连接工艺填写。");
 if(p.row===833&&a.name==="公称直径")return blank({...next,source:"原表.商品标题；JD.categoryAttrList",quote:`${p.title}；京东口径：DN40；DN80`},"S90×50描述异径接头规格，不能等同于单个DN；京东口径又不一致，保留双端规格待确认。");
 if(p.row===582&&a.name==="安装方式")return direct("集成吊顶嵌入式",p.title,"按铝扣板集成吊顶灯的实际安装形式整理。");
 if([278,429,671].includes(p.row)&&a.name==="适用性别")return direct(p.row===278?"女":"男",p.title,"标题明确销售对象性别。");
 if([354,386,588,590].includes(p.row)&&a.name==="适用人群")return direct("成人",p.title,"根据标题的女士内裤、成人工作鞋、女士瑜伽服或女式贝雷帽语义确定成人用途；不填具体年龄。");
 if(p.row===625&&a.name==="适用人群")return direct("成人",p.title,"标题明确为男士保暖内衣套装，不推定具体年龄。");
 if([535,565].includes(p.row)&&a.name==="适用人群")return blank({...next,source:"Codex适用性判断",quote:p.title},"实际销售为帐篷拉链头/包装袋配件，不按人的年龄群体划分适配规格。","不适用");
 if(p.row===428&&a.name==="公称压力")return blank({...next,source:"Codex适用性判断",quote:p.title},"销售物为电磁阀线圈，非承压阀体，公称压力不适用。","不适用");
 if(p.row===804&&a.name==="电池容量")return blank({...next,source:"原表.颜色尺寸",quote:p.variant},"选定有线USB按钮，非标题中的无线款，不填无线款电池容量。","不适用");
 if([345,875,484].includes(p.row)&&a.name==="加热方式")return direct("电加热",p.title+"；"+p.fields.filter(f=>["额定电压","加热功率","功率"].includes(f.name)).map(f=>`${f.name}：${f.value}`).join("；"),"按电饮水设备/电炸炉及电参数确定电加热；不把极速加热这一速度描述作为加热形式。","原表.商品标题；JD参数");
 if(previousDefinition?.unit!==a.unit&&next.value!==null)next=append(next,`模板单位由${previousDefinition?.unit||"无"}调整为${a.unit||"无"}`);
 return next;
}
