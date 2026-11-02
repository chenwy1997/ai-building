import { resolve } from 'node:path';
import { digest, stable } from '../contracts.ts';
import { save } from '../../storage.ts';
const run='run-2026-09-15T09-19-00-941Z';
// Human/agent semantic adjudication of this completed run, not an automatic scoring rule.
const judgments=[
 {name:'充电式电钻',verdict:'needs-policy',finding:'核心钻孔参数齐备；把电池数量、是否含充电器写成“配置明确时”才填，混淆信息是否已知和属性适用；型号无条件必填与项目政策不同。',accepted:'外形、材料等合理选填扩展不算错误；自查移除了不必要安装接口。'},
 {name:'O形圈',verdict:'needs-policy',finding:'14个维度均有覆盖，但硬度、适用温度、介质相容性被降为选填；不符合本项目面向工业选型的核心要求。胶料牌号与型号的要求也需统一。',accepted:'材料、自由内径、截面对象清楚，没有添加脱离沟槽工况的承压数值。'},
 {name:'梅花头插件',verdict:'needs-selection',finding:'模型以“配合工具座”为由排除适配品牌和系列；接口公称尺寸不证明所有品牌系列兼容，应保留制造商限定范围的条件。品牌及型号填写政策也偏离。',accepted:'作用中心距、接口截面和最大允许扭矩均正确；头型和偏置升级为必填可视为合理更严格选型，不机械判错。'},
 {name:'合金锯片',verdict:'needs-policy',finding:'核心几何和性能维度齐备；制造商型号被无条件必填，需要回到“确有型号或货号时”的统一政策。',accepted:'安装孔形式改必填以及适配/使用边界的选填扩展可以保留；没有把基体厚度和锯路混为一项。'},
 {name:'热风枪发热芯',verdict:'needs-policy',finding:'把外部引线数设为全类必填，漏掉采用端子而无引线的分支；测温元件有无的条件近似循环表述；冷态电阻、发热体材质被强制要求超出本项目基础替换模板。',accepted:'“适配对象及范围”可等义承接分开的适配品牌/机型/系列，不把精确ID缺失的3项机械计为遗漏；额定电气值与机械安装对象保留。'},
 {name:'剥线钳',verdict:'needs-policy',finding:'导体结构和绝缘类型以“厂家已声明”为必填前提，不能形成明确的核心资料要求；绝缘作业电压也以“已标明电压”为条件，存在循环。',accepted:'预设剥线孔、剥皮长度等条件表述与参考等义；自查删除了重叠的手柄主体材质。'},
 {name:'电动工具充电组套',verdict:'needs-selection',finding:'参考对象是电池/充电器供电组套，模型扩成可含工具或空盒的一般组套；35项中有重复组成、件数、驱动方式、净质量及电池电压。遗漏充电器输入电源，兼容范围也未完整表达。',accepted:'随附电池电压清单与充电输出定义本身正确；新增建议为0不代表没有多余属性。'},
 {name:'空压机气泵头',verdict:'needs-policy',finding:'安装接口被降为选填，影响机头替换配合；型号要求仍与项目政策不同。',accepted:'理论排量/实测排气量、配套驱动功率和机头耗电未混用；冷却润滑按机型条件填写可接受。'},
 {name:'液压式捣固机',verdict:'needs-selection',finding:'未选外接回油背压；捣固作用方式和连续振动频率变为选填，使手持击打与连续振动的条件分支不完整；轨道范围用“厂家已声明”代替机型适用条件。',accepted:'击打次数与振动频率没有混用，增加电动泵站电源条件是合理扩展。'},
 {name:'防爆套筒扳杆',verdict:'needs-selection',finding:'通用外形尺寸可包含总长，但本次只设选填且理由为辅助，未满足参考的长度核心要求；材料也降为选填。附加通用适用限制与防火花限制有内容重叠风险。',accepted:'套筒输出接口方向正确；未选套筒工作孔或批头尺寸，未由合金材料推定认证。'},
];
export async function main(){
 const dir=resolve(import.meta.dir,'../../workspace/output/dictionary-trial',run);
 const results=await Bun.file(resolve(dir,'results.json')).json(),usage=await Bun.file(resolve(dir,'usage.json')).json(),status=await Bun.file(resolve(dir,'status.json')).json();
 if(results.length!==10||results.some((r:any)=>!r.final))throw Error('固定运行未完成');
 if(digest(results)!=='91cac5435505cdfa3bc5352fe55e192e034244b2911aaa7fae6ce72fc6c838f1')throw Error('审阅结果快照已变化，需重新语义判断，不能沿用本次人工结论');
 const policies=(r:any)=>r.selections.map((s:any)=>[s.propertyId,s.revision,s.requirement,s.condition??null,s.unitId??null]).sort((a:any,b:any)=>a[0].localeCompare(b[0]));
 const unchanged=results.filter((r:any)=>digest(policies(r.draft))===digest(policies(r.final))).map((r:any)=>r.category.name);
 const phases=['select','audit'].map(phase=>{const rows=usage.filter((e:any)=>e.phase===phase),sum=(k:string)=>rows.reduce((s:number,e:any)=>s+(e.usage?.[k]??0),0);return {phase,input:sum('prompt_tokens'),output:sum('completion_tokens'),hit:sum('prompt_cache_hit_tokens'),miss:sum('prompt_cache_miss_tokens'),cny:rows.reduce((s:number,e:any)=>s+(e.charged??e.reserved),0)};});
 const totals={compiled:10,passedAllProjectChecks:0,selectionCorrections:judgments.filter(j=>j.verdict==='needs-selection').length,policyCorrections:judgments.filter(j=>j.verdict==='needs-policy').length,unchangedSelectionAfterAudit:unchanged.length,referenceUpdated:false,newConcepts:results.reduce((s:number,r:any)=>s+r.final.newConcepts.length,0)};
 const report={run,sourceResultsHash:digest(results),reviewer:'本执行者人工语义核对，非独立第三方',totals,judgments,phases,unchanged,status:status.usage,limitations:['本轮是已知开发类目的回归，不是泛化或行业准确率评估。','0类完全通过是本项目完整验收门槛的结果，不表示所有属性错误；逐类区分选配与填写策略。','本轮没给模型原先明确的类目对象说明，也未给统一品牌/型号及核心填写政策，不能把全部偏差归结为模型知识不足。','预算估算按官方高峰价格；平台账单为准。','二轮包含前轮输出，属于同一模型自查，不是独立裁判。']};
 await save(resolve(dir,'semantic-review.json'),report);
 const esc=(s:string)=>s.replace(/\|/g,'\\|').replace(/\n/g,'<br>');
 const u=status.usage;
 const md=`# DeepSeek固定10类验证结果\n\n本轮已实际完成。**调用、JSON编译和缓存可用，但没有达到直接扩量的语义验收门槛。** 参考库未被模型结果覆盖。\n\n## 实际用量\n\n|指标|结果|\n|---|---:|\n|类目 / 请求|10 / ${u.requests}|\n|输入Token|${u.input}|\n|输出Token|${u.output}|\n|缓存命中 / 未命中|${u.hit} / ${u.miss}|\n|输入缓存命中率|${(u.hitRate*100).toFixed(2)}%|\n|思考Token|${u.reasoning}|\n|本地重放|${u.localReplays}|\n|按高峰价格保守估算|¥${u.conservativeCny.toFixed(6)}|\n|预算上限|¥${u.budgetCny}|\n\n官方价格依据：[DeepSeek模型价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。费用按API用量估算，并非平台账单读数；此轮所有请求均返回usage，没有费用不明请求。\n\n## 语义结论\n\n- 10/10返回可编译结果，0个格式/请求失败。\n- 按既定项目要求，0/10完全通过。**6类主要需要填写策略调整，4类还需选配修订。** 这不是“所有属性都错”，详见逐类判断。\n- 未出现需新建概念的建议，但充电组套仍出现大量重复和错对象，说明“字典里能找到”不等于“应该选”。\n- 二轮自查中，${unchanged.length}/10类的属性ID与填写条件完全未变；只有电钻、剥线钳各移除1项。不能据此推断多轮必然改善质量。\n\n|类目|主要问题|接受的正确或等义部分|\n|---|---|---|\n${judgments.map(j=>`|${j.name}|${esc(j.finding)}|${esc(j.accepted)}|`).join('\n')}\n\n## 多轮费用与缓存\n\n|轮次|输入|输出|命中率|保守费用|\n|---|---:|---:|---:|---:|\n${phases.map(p=>`|${p.phase==='select'?'属性选配':'同模型自查'}|${p.input}|${p.output}|${(100*p.hit/p.input).toFixed(2)}%|¥${p.cny.toFixed(6)}|`).join('\n')}\n\n自查轮虽然缓存高，仍消耗输出费用，而且本次没有解决主要语义问题。官方说明缓存依赖已落盘的完整前缀，多轮追加可以复用，但不保证100%命中：[缓存机制](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)。\n\n## 根因定位与下一步\n\n本轮输入已经有属性定义、对象和单位；缺少的是已确认的类目对象范围、适用分支和统一业务填写政策。为避免泄露答案，我没有发送参考模板，但也未把这部分本应提供的任务约束作为正式输入。充电组套歧义和品牌/型号要求漂移与此有关，不能据这次结果断言模型没有行业知识。\n\n接下来应增加可版本化的“类目适用说明”和“填写政策”，与属性定义分开。说明只描述商品对象、适用分支和选型要求，不直接塞最终属性ID答案；仍保留相邻候选检验错配。未知资料不等于不适用，条件不能写成“有资料时才填”。同时在库中记录重叠概念的关系，避免同时选组成清单、件数、驱动方式的近义版本。\n\n不增加泛泛的自查轮次。先针对充电组套、O形圈、发热芯做一次小范围对照，验证新增约束是否解决范围和策略问题，再重新验收10类。本轮到此结束，没有继续消费预算。\n\n## 文件与复现\n\n[查看模型实际模板](模型模板.md) · [语义判断JSON](semantic-review.json) · [精确差异索引](comparison.json)\n\n恢复已有运行（复用已完成结果，不重复调用）：\n\n\`bun run category-attributes-governance:dictionary-trial --resume=${run} --direct\`\n\n运行入口、协议、预算、恢复和审阅脚本均已记录在dictionary/trial目录；新运行会产生费用，当前不建议直接重复同一提示词。\n`;
 await Bun.write(resolve(dir,'查看结果.md'),md);
 const required:any={required:'必填',conditional:'条件必填',optional:'选填'};
 const detail='# DeepSeek本轮实际输出模板\n\n这些是模型原始选配编译后的模板，存在审阅问题，未采用为正式参考。\n\n'+results.map((r:any)=>`## ${r.category.name}\n\n${r.category.pathNames.join(' › ')}\n\n${r.final.note}\n\n|属性|填写要求|定义与单位|\n|---|---|---|\n`+r.final.attributes.map((a:any)=>`|${esc(a.name)}<br>\`${a.id}@${a.revision}\`|${required[a.requirement]}${a.condition?'<br>'+esc(a.condition):''}|${esc(a.definition)}<br>${esc(a.selectedUnitId??'文本/布尔；单位或工况见限定')}${a.qualifications.length?'<br>'+esc(a.qualifications.join('；')):''}|`).join('\n')+'\n').join('\n');
 await Bun.write(resolve(dir,'模型模板.md'),detail);
 console.log(JSON.stringify({dir,totals,phases},null,2));
}
if(import.meta.main)main().catch(e=>{console.error(e.message);process.exitCode=1;});
