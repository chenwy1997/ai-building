import { createHash } from 'node:crypto';
import type { Outcome, Attribute } from '../../types.ts';
import { seed } from '../seed.ts';
import { compileSelections, digest, toStdText, validateDictionary } from '../contracts.ts';
import type { Dictionary, Property, Selection, Unit } from '../contracts.ts';
import { additions, edits, reviewed, sourceHash, sources, unresolved } from './review.ts';

const commonBasis:Property['basis']=[{kind:'project-definition',ref:'dictionary/hardware/review.ts'}];
const common:Property[]=[];
const aliases=new Map<string,string>();
function link(id:string,members:string[]) {for(const m of members){if(aliases.has(m))throw Error(`重复概念分配 ${m}`);aliases.set(m,id);}}
function define(id:string,name:string,definition:string,object:string,type:Property['type'],unitIds:string[],members:string[],qualifications:string[]=[]) {
  const uid=unitIds[0];
  common.push({id,revision:1,name,definition,object,type,unitIds,quantity:uid?allUnits.find(u=>u.id===uid)!.quantity:null,aliases:[],qualifications,excludedMeanings:[],basis:commonBasis});
  link(id,members);
}
const allUnits:Unit[]=[...seed.units,{id:'MPa',symbol:'MPa',quantity:'pressure'},{id:'kN',symbol:'kN',quantity:'force'},{id:'rpm',symbol:'r/min',quantity:'rotational-frequency'}];
// Explicitly reviewed members; these mappings do not run against unseen categories.
link('sh.own.brand',reviewed.map(r=>`${r.slug}.${r.keys.includes('own_brand')?'own_brand':'brand'}`));
link('sh.own.model',reviewed.map(r=>`${r.slug}.${r.keys.includes('own_model')?'own_model':'model'}`));
link('sh.compatible.brand',['tool_battery.compatible_brand','torque_insert.compatible_brand','heat_core.compatible_brand']);
link('sh.compatible.model',['tool_battery.compatible_model','heat_core.compatible_model']);
link('sh.battery.rated_capacity',['tool_battery.capacity_ah']);
link('sh.oring.free_inner_diameter',['oring.inner_diameter']);
link('sh.oring.cross_section_diameter',['oring.cross_section']);
link('sh.electrical.rated_input_power',['heat_core.rated_power']);
link('sh.electrical.rated_input_voltage',['heat_core.rated_voltage']);
link('sh.heater.external_lead_count',['heat_core.heating_wire_count']);
link('sh.material.insulating_support',['heat_core.insulation_material']);
link('sh.configuration.sensor_included',['heat_core.with_sensor']);
link('sh.configuration.sensor_type',['heat_core.sensor_type']);
link('sh.geometry.overall_length',['stripper.overall_length','striking_wrench.overall_length','socket.overall_length','wire_rope_cutter.overall_length','wool_brush.overall_length','impact_bit.total_length','spring_clamp.overall_length']);
// Specific material objects remain in each binding's application context.
link('sh.material.body',['spring_compressor.material','striking_wrench.material','torque_insert.material','pipe_bender.structure_material','socket.material','stripper.body_material','combination_pliers.material','impact_bit.material','spring_clamp.body_material','non_sparking_socket.material','hex_standoff.material','floor_drain.body_material']);
define('sh.hardware.compatible_series','适配设备系列','制造商明确声明兼容的设备系列；不据相同品牌或相似外形推断整个系列均兼容。','目标商品的适配设备','text',[],['tool_battery.compatible_series','torque_insert.compatible_series','heat_core.compatible_series']);
define('sh.hardware.surface_treatment','表面处理','指定商品部件表面的镀覆、涂装、氧化或其他处理工艺；表面处理不直接证明绝缘作业、防火花或冲击适用性能。','目标商品指定表面','text',[],['spring_compressor.surface_treatment','striking_wrench.surface_treatment','torque_insert.surface_treatment','socket.surface_treatment','wire_rope_cutter.surface_treatment','claw_hammer.surface_treatment','combination_pliers.surface_treatment','impact_bit.surface_treatment','spring_clamp.surface_treatment','non_sparking_socket.surface_treatment','hex_standoff.surface_treatment','floor_drain.surface_treatment','drawer_box.surface_treatment'],['指定处理部位；可同时存在多道工艺']);
define('sh.hardware.package_count','单包装本品数量','一个销售包装内目标商品本体的数量；不将不同种类附件加总到本品数量中。','销售包装中的本品','integer',['count'],['torque_insert.pack_quantity','wool_brush.pack_qty','impact_bit.pack_count','spring_clamp.pack_quantity','heat_core.pack_quantity','hex_standoff.package_qty']);
define('sh.hardware.tool_battery_voltage','工具要求的电池标称电压','目标工具设计采用的电池标称电压及组合方式；不得以满充或宣传峰值电压替代。','工具的电池输入要求','text',[],['drill.battery_platform_voltage','grass_trimmer.voltage_platform'],['数值V；多电池串联方案逐项注明']);
define('sh.hardware.supplied_battery_capacity','随附电池容量','销售配置实际包含的电池额定容量，按单块及型号分别记录；不是全部兼容电池容量列表。','实际随附电池','text',[],['drill.battery_capacity','grass_trimmer.battery_capacity'],['电池型号/数量:单块额定容量Ah；裸机不适用']);
define('sh.hardware.battery_interface','电池接口平台','制造商标识的机械及电气连接平台或接口系列；仅电压相同不能证明接口兼容。','工具或电池的连接接口','text',[],['drill.battery_interface','grass_trimmer.battery_interface','tool_battery.interface_series'],['明确接口所在部件以及平台名称']);
define('sh.hardware.supplied_battery_count','随附电池数量','销售配置实际包含的电池块数；已知裸机配置为零。','实际随附电池','integer',['count'],['drill.supplied_battery_count','grass_trimmer.battery_count']);
define('sh.hardware.charger_included','是否包含充电器','销售配置是否实际随附充电器；未知不得表示为false。','销售配置中的充电器','boolean',[],['drill.charger_included','grass_trimmer.charger_included']);
define('sh.hardware.socket_drive_square','套筒驱动方孔规格','套筒与扳手或接杆驱动方头配合的方孔公称对边尺寸。','套筒驱动方孔','text',[],['socket.drive_size','non_sparking_socket.drive_end_size'],['保留数值及公英制单位；不是螺母工作端尺寸']);
define('sh.hardware.socket_working_hex','套筒工作端六角对边尺寸','套筒六角工作孔与六角紧固件配合的公称对边尺寸。','套筒工作端六角孔','text',[],['socket.socket_size','non_sparking_socket.socket_size'],['保留数值和公英制单位；不是驱动方孔尺寸']);
define('sh.hardware.socket_impact_suitable','是否适用冲击工具','制造商是否明确声明该套筒可由冲击工具驱动；未知不作否定结论，也不由颜色或材料推断。','套筒的驱动适用性','boolean',[],['socket.impact_rated','non_sparking_socket.impact_suitable']);
define('sh.hardware.insulated_working_voltage','绝缘工具允许作业电压','制造商按绝缘作业用途声明的允许使用电压，分别标明交流或直流制式；不是试验耐压。','绝缘作业工具','text',[],['stripper.insulation_voltage','insulated_driver.rated_voltage','combination_pliers.insulation_voltage'],['AC/DC:数值V；需对应绝缘工具标准或声明']);
const numericUnits:Record<string,string>={'个':'count','只':'count','根':'count','齿':'count','件':'count','把':'count','枚':'count','支':'count',kg:'kg',mm:'mm',Ah:'Ah',MPa:'MPa','r/min':'rpm',kN:'kN',W:'W',V:'V'};
const generalPolicy='必填策略为本次项目选型政策；必要字段仍需真实资料，未知不得编造。型号只有制造商已分配时必填。';

function applyEdit(p:Attribute,e:typeof edits[string]|undefined):Attribute {
  const a=structuredClone(p);if(!e)return a;
  if(e.name!==undefined)a[1]=e.name;if(e.type!==undefined)a[2]=e.type;if(e.requirement!==undefined)a[3]=e.requirement;
  if(e.unit!==undefined)a[4]=e.unit;if(e.condition!==undefined)a[6]=e.condition;if(e.definition!==undefined)a[7]=e.definition;if(e.format!==undefined)a[8]=e.format;
  return a;
}
export function buildHardware(text:string) {
  if(createHash('sha256').update(text).digest('hex')!==sourceHash)throw Error('参考文件已变化，必须先重新审阅，禁止自动采用新内容');
  const source=JSON.parse(text) as Outcome[];
  if(source.length!==reviewed.length)throw Error('参考类目数量改变');
  const dictionary:Dictionary={schema:'sanheng-property-dictionary-v1',units:allUnits,properties:[...structuredClone(seed.properties),...structuredClone(common)]};
  const templates:Array<{category:Outcome['category'];selections:Selection[];attributes:ReturnType<typeof compileSelections>;applications:Array<{propertyId:string;sourceKey:string;context:string;sourceRefs:string[]}>;evidence:Outcome['evidence']}> = [];
  const comparisons:Array<{categoryId:string;categoryName:string;sourceKey:string;before:Attribute|null;after:unknown;action:string;reason:string}> = [];
  const revisions:unknown[]=[];
  const usedEdits=new Set<string>(),usedLinks=new Set<string>();
  for(const r of reviewed) {
    const c=source.find(c=>c.category.id===r.id);if(!c)throw Error(`找不到原类目 ${r.id}`);
    if(c.category.pathNames[1]!=='五金工具')throw Error(`不属于五金工具 ${r.id}`);
    const keys=c.attributes.map(a=>a[0]);
    if(keys.length!==new Set(keys).size || digest([...keys].sort())!==digest([...r.keys].sort()))throw Error(`尚未审阅的属性变化 ${r.slug}`);
    const selections:Selection[]=[],applications:typeof templates[number]['applications']=[];
    for(const original of [...c.attributes,...(additions[r.slug]??[])]) {
      const key=`${r.slug}.${original[0]}`,e=edits[key]; if(e)usedEdits.add(key);
      const isNew=!(r.keys.includes(original[0]));
      if(e?.remove) {comparisons.push({categoryId:r.id,categoryName:c.category.name,sourceKey:original[0],before:original,after:null,action:'删除',reason:e.reason});continue;}
      const p=applyEdit(original,e);
      let propertyId=aliases.get(key);
      if(propertyId)usedLinks.add(key);
      if(!propertyId) {
        propertyId=`sh.hardware.${r.slug}.${p[0]}`;
        const uid=p[2]==='number'?numericUnits[p[4]]:undefined;
        if(p[2]==='number'&&!uid)throw Error(`尚未核对数值单位 ${key}: ${p[4]}`);
        const type:Property['type']=p[2]==='boolean'?'boolean':p[2]==='number'?(uid==='count'?'integer':'number'):'text';
        const basis:Property['basis']=[{kind:'project-definition',ref:`source-sha256:${sourceHash}#${r.id}/${original[0]}`},{kind:'project-definition',ref:`dictionary/hardware/review.ts#${key}`}];
        for(const s of e?.sources??[])basis.push({kind:'domain-reference',ref:sources[s].url});
        if(isNew&&r.slug==='nailer')basis.push({kind:'domain-reference',ref:sources.senco.url});
        dictionary.properties.push({id:propertyId,revision:1,name:p[1],definition:p[7],object:`${c.category.name}中本定义指定的对象`,type,quantity:uid?allUnits.find(u=>u.id===uid)!.quantity:null,unitIds:uid?[uid]:[],aliases:[],qualifications:[...(p[8]?[`格式：${p[8]}`]:[]),...(type==='text'&&p[4]?[`涉及数值时明确单位：${p[4]}`]:[]),...(p[5].length?['历史枚举仅保留于来源，不限制本属性的开放取值']:[])],excludedMeanings:[],basis});
      }
      const prop=dictionary.properties.find(d=>d.id===propertyId)!;
      const selection:Selection={propertyId,revision:prop.revision,requirement:p[3],rationale:e?.reason??`经本轮复核，此字段用于${c.category.name}的身份识别、选型、结构或交付配置描述。${generalPolicy}`};
      if(selection.requirement==='conditional') {
        if(!p[6].trim())throw Error(`条件必填缺少经过审阅的条件 ${key}`);
        selection.condition=p[6];
      }
      // Shared manufacturer-model concept uses one explicit project policy, no 'invent an absent model'.
      if(propertyId==='sh.own.model')selection.condition='制造商已为该商品分配型号或料号时';
      selections.push(selection);
      applications.push({propertyId,sourceKey:original[0],context:p[7],sourceRefs:original[9]});
      const differences=[];
      if(aliases.has(key))differences.push('复用标准ID');
      if(e)differences.push('修订');
      if(p[2]==='single'||p[2]==='multi')differences.push('枚举改开放文本');
      comparisons.push({categoryId:r.id,categoryName:c.category.name,sourceKey:original[0],before:isNew?null:original,after:{propertyId,name:prop.name,type:prop.type,definition:prop.definition,unitIds:prop.unitIds,requirement:selection.requirement,condition:selection.condition??null,applicationContext:p[7]},action:isNew?'新增':differences.join('；')||'保留并定ID',reason:e?.reason??(isNew?'增加有明确描述对象的选型维度；未知数值不推断。':aliases.has(key)?'经本轮审阅属于同一概念；保留原类目的具体对象说明。':'复核原定义后保留，限制为当前品类对象，不自动推广到其他类目。')});
      revisions.push({key,propertyId,sourceHash,review:'project-semantic-review',externalSupport:e?.sources??[],policy:selection});
    }
    templates.push({category:structuredClone(c.category),selections,attributes:compileSelections(dictionary,selections),applications,evidence:c.evidence});
  }
  for(const k of Object.keys(edits))if(!usedEdits.has(k))throw Error(`未使用的审阅项 ${k}`);
  for(const k of aliases.keys())if(!usedLinks.has(k))throw Error(`未使用的共用概念关系 ${k}`);
  validateDictionary(dictionary);
  const actualIds=new Set(templates.flatMap(t=>t.selections.map(s=>s.propertyId)));
  const usedDictionary:Dictionary={...dictionary,properties:dictionary.properties.filter(p=>actualIds.has(p.id)).sort((a,b)=>a.id.localeCompare(b.id,'en'))};
  const actualUnits=new Set(usedDictionary.properties.flatMap(p=>p.unitIds));usedDictionary.units=usedDictionary.units.filter(u=>actualUnits.has(u.id));
  const counts=new Map<string,number>();for(const t of templates)for(const s of t.selections)counts.set(s.propertyId,(counts.get(s.propertyId)??0)+1);
  return {schema:'sanheng-hardware-pack-v1',status:'project-reviewed-development-reference; independent acceptance pending',sourceHash,dictionary:usedDictionary,dictionaryHash:digest(usedDictionary),templates,comparisons,revisions,sources,unresolved,
    metrics:{categories:templates.length,sourceAttributes:source.reduce((n,c)=>n+c.attributes.length,0),templateAttributes:templates.reduce((n,c)=>n+c.attributes.length,0),concepts:usedDictionary.properties.length,sharedConcepts:[...counts.values()].filter(n=>n>1).length,reusedBindings:[...counts.values()].reduce((n,c)=>n+Math.max(0,c-1),0),removed:comparisons.filter(c=>c.action==='删除').length,added:comparisons.filter(c=>c.action==='新增').length,semanticEdits:Object.keys(edits).length,openEnumConversions:comparisons.filter(c=>c.action.includes('枚举')).length,apiRequests:0},
    compactDictionary:toStdText(usedDictionary)};
}
