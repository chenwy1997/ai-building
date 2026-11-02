import { compileSelections, digest, toStdText, validateDictionary } from '../contracts.ts';
import type { Dictionary, Selection } from '../contracts.ts';
import type { OpenAiChatRequest, OpenAiMessage } from '../../../../ai/types.ts';
export const protocolVersion='dictionary-selection-trial-v1';
// Domain routing, authored before the run. Does not read reference selections or expected requirements.
export const groups:Record<string,string[]>={
 powered:['sh.hardware.drill.','sh.hardware.grass_trimmer.','sh.hardware.tool_battery.','sh.hardware.tool_set.','sh.hardware.battery_','sh.hardware.tool_battery_voltage','sh.hardware.supplied_','sh.hardware.charger_','sh.hw2.hammer.','sh.hw2.drill.','sh.hw2.tool.','sh.hw2.charger.','sh.hw2.soft_start.','sh.hw2.kit.','sh.ref60.kit.','sh.ref60.tool.','sh.ref60.cutting.'],
 seals:['sh.hardware.oring.','sh.oring.','sh.hw2.roof.','sh.hw2.anchor.','sh.hardware.hex_standoff.'],
 handtools:['sh.hardware.torque_insert.','sh.hardware.socket','sh.hardware.non_sparking_socket.','sh.hardware.striking_wrench.','sh.hardware.insulated_driver.','sh.hardware.impact_bit.','sh.hw2.driver.','sh.hw2.ratchet.','sh.hw2.y_socket.','sh.hw2.bar.','sh.hw2.non_sparking.','sh.ref60.bar.','sh.ref60.kit.drive_outputs'],
 cutting:['sh.hardware.saw_blade.','sh.hardware.stripper.','sh.hardware.combination_pliers.','sh.hardware.wire_rope_cutter.','sh.hardware.utility_knife.','sh.hw2.blade.','sh.hw2.scissors.','sh.hw2.annular.','sh.hw2.cut.','sh.hw2.bolt_cutter.','sh.ref60.stripper.','sh.ref60.knife.'],
 heating:['sh.hardware.heat_core.','sh.heater.','sh.configuration.sensor','sh.ref60.heater.','sh.hw2.soft_start.','sh.hw2.hammer.'],
 hydraulic:['sh.hardware.rail_gap_adjuster.','sh.hardware.pipe_bender.','sh.hardware.spring_compressor.','sh.hw2.compressor.','sh.hw2.hydraulic.','sh.hw2.tamper.','sh.hw2.engine.','sh.ref60.hydraulic.','sh.ref60.tamper.','sh.ref60.rail.'],
};
export const routing:Record<string,string>={'充电式电钻':'powered','O形圈':'seals','梅花头插件':'handtools','合金锯片':'cutting','热风枪发热芯':'heating','剥线钳':'cutting','电动工具充电组套':'powered','空压机气泵头':'hydraulic','液压式捣固机':'hydraulic','防爆套筒扳杆':'handtools'};
const commonPrefixes=['sh.own.','sh.geometry.','sh.material.','sh.electrical.','sh.battery.','sh.mechanical.','sh.compatible.','sh.configuration.battery_','sh.hw2.geometry.','sh.hw2.electrical.','sh.hw2.interface.','sh.hw2.compatibility.','sh.hw2.performance.','sh.hw2.material.','sh.hw2.handle.','sh.hardware.compatible_series','sh.hardware.surface_treatment','sh.hardware.package_count','sh.hardware.insulated_working_voltage'];
export function buildKnowledge(dictionary:Dictionary){
 validateDictionary(dictionary);
 const latest=new Map<string,Dictionary['properties'][number]>();for(const p of dictionary.properties)if(!latest.has(p.id)||latest.get(p.id)!.revision<p.revision)latest.set(p.id,p);
 const all=[...latest.values()].sort((a,b)=>a.id.localeCompare(b.id,'en'));
 const common=all.filter(p=>commonPrefixes.some(prefix=>p.id.startsWith(prefix)));
 const subset=(properties:typeof all):Dictionary=>{const unitIds=new Set(properties.flatMap(p=>p.unitIds));return {schema:dictionary.schema,properties,units:dictionary.units.filter(u=>unitIds.has(u.id))};};
 return Object.fromEntries(Object.entries(groups).map(([key,prefixes])=>{const specific=all.filter(p=>!common.includes(p)&&prefixes.some(prefix=>p.id.startsWith(prefix)));const d=subset([...common,...specific]);return [key,{dictionary:d,commonText:toStdText(subset(common)),specificText:toStdText(subset(specific)),hash:digest(d),count:d.properties.length}];}));
}
export const systemPrompt=`你负责类目属性模板选配，不治理类目名称层级、不填写商品值。按属性定义的对象、方向、物理量和限定条件判断是否适用，不因同名或相似类目就套用。库中可能包含相邻品类、近义定义及不适用项。
优先复用准确适用的属性ID及revision；同一语义选最贴合的一项，不重复添加。可同名不同对象；不要为了覆盖率强选无关属性。品牌、型号、供应商、配套机型分开。核心选型属性必填；取决于产品结构、功能或交付状态的属性条件必填，写清条件；辅助描述选填。缺少某型号数值不等于属性不适用；布尔未知不等于否。材料不证明功能、认证或性能。
先考虑身份、结构、几何配合、工作能力、动力/接口、材料、测量条件和交付配置中真正适用的维度。不是每类都需要全部维度。不得把输入/输出、整体/附件、额定/峰值、试验/允许使用、开口/深度、线径/截面积混淆。保留原ID。
仅输出无缩进JSON对象，禁止Markdown。JSON格式：{"categoryId":"输入的类目ID","selections":[{"propertyId":"知识库中的完整ID","revision":1,"requirement":"required或optional或conditional","condition":"仅conditional时提供适用条件","rationale":"简短选型理由"}],"newConcepts":[{"name":"缺失属性名","definition":"精确定义","object":"描述对象","reason":"现有库不足的原因"}],"note":"简短对象解释"}。非conditional时必须省略condition。不得在selections内添加名称、定义、枚举等字段来覆写知识库；需要的新概念只放newConcepts，建议不自动采用。`;
export const auditPrompt='对上一轮JSON做一次独立于措辞的自查：逐项核对对象和接口方向、必要工况、是否把单一机型当全类、条件是否具体；再查核心选型遗漏及同义重复。候选存在不代表应该选，缺项只在知识库确无可用概念时提出。输出修订后的完整JSON（不是补丁），保持同一categoryId；不要为改变而改变，不输出商品数值。';
export function firstRequest(model:string,c:{id:string;name:string;pathNames:string[]},knowledge:ReturnType<typeof buildKnowledge>):OpenAiChatRequest{
 const group=routing[c.name],pack=group?knowledge[group]:undefined;if(!pack)throw Error('不在固定试跑清单');
 return {model,thinking:{type:'disabled'},temperature:0,max_tokens:6000,response_format:{type:'json_object'},messages:[{role:'system',content:systemPrompt+'\n通用属性知识（固定前缀）：\n'+pack.commonText},{role:'user',content:'工具族知识（固定内容，不是本类答案）：\n'+pack.specificText+'\n目标类目：'+JSON.stringify(c)}]};
}
export function auditRequest(first:OpenAiChatRequest,content:string):OpenAiChatRequest{return {...first,messages:[...first.messages,{role:'assistant',content},{role:'user',content:auditPrompt}]};}
export function parseReply(content:string,categoryId:string,dictionary:Dictionary){
 const x=JSON.parse(content);if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['categoryId','selections','newConcepts','note'].includes(k)))throw Error('返回顶层格式不符合约定');
 if(x.categoryId!==categoryId)throw Error('类目ID发生变化');
 if(!Array.isArray(x.selections)||x.selections.length===0||x.selections.length>60)throw Error('属性选择数量非法');
 if(!Array.isArray(x.newConcepts)||x.newConcepts.length>20||typeof x.note!=='string')throw Error('缺失建议或说明格式错误');
 for(const n of x.newConcepts)if(!n||typeof n!=='object'||Object.keys(n).some(k=>!['name','definition','object','reason'].includes(k))||['name','definition','object','reason'].some(k=>typeof n[k]!=='string'||!n[k].trim()))throw Error('新概念建议不完整');
 const selections=x.selections as Selection[];
 return {categoryId,selections,attributes:compileSelections(dictionary,selections),newConcepts:x.newConcepts as Array<{name:string;definition:string;object:string;reason:string}>,note:x.note as string};
}
