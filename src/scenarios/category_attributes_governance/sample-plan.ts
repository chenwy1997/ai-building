import {join} from 'node:path';
import {prepare,SOURCE} from './context.ts';
import {ROOT,save} from './storage.ts';
// One representative from each existing second-level business branch; no taxonomy edits.
const selection=[['电动工具','充电式电钻'],['汽修工具','弹簧压缩器'],['紧固密封件','O形圈'],['动力工具附件','电动工具电池'],['电子工具','剥线钳'],['扳手','梅花敲击扳手'],['锯/锉','半圆锉'],['扭力工具','梅花头插件'],['管道工具','液压式弯管器'],['动力工具耗材','合金锯片'],['套筒及旋具头','六角套筒'],['绝缘工具','绝缘六角螺丝批'],['线缆工具','钢索剪'],['工具组套','组套工具箱'],['锤/凿/冲','羊角锤'],['涂装工具','羊毛刷'],['刀/剪','工业美工刀'],['园林工具','水枪'],['钳','钢丝钳'],['气动工具','气动钉枪'],['尺','水平尺（工具）'],['螺丝批及批头','冲击型内六角批头'],['钳工工具','弹簧夹'],['园林专用工具','充电式草坪修剪机'],['铁路专用工具','液压式轨缝调整器'],['动力工具零件','热风枪发热芯'],['防爆工具','防爆六角套筒'],['紧固件','六角螺柱'],['五金杂品','地漏'],['工具车/箱/包','抽屉式工具箱']];
export async function samplePlan(){const context=await prepare('五金工具',SOURCE);
 const categories=selection.map(([parent,name])=>{const candidates=context.leaves.filter(c=>c.pathNames[2]===parent&&c.name===name);if(candidates.length!==1)throw new Error(`样本必须唯一：${parent}/${name}，命中${candidates.length}`);return candidates[0]!;});
 const directory=join(ROOT,'plans','hardware-30');await save(join(directory,'manifest.json'),{schema:'hardware-stratified-30-v1',source:SOURCE,contextHash:context.contextHash,scopeLeaves:context.leaves.length,categories,coverage:'原30个二级分支各选1类；非随机统计样本，不能据此推算全量合格率',apiRequests:0});
 await Bun.write(join(directory,'样本清单.md'),'# 五金工具30类试跑清单\n\n保持原类目；30个二级分支各取1类，覆盖整机、配件、耗材、普通/绝缘/防爆工具、紧固密封件等。本文件只准备清单，没有API调用。\n\n|序号|二级分支|末级类目|完整业务路径|\n|---|---|---|---|\n'+categories.map((c,i)=>`|${i+1}|${c.pathNames[2]}|${c.name}|${c.pathNames.slice(1).join(' > ')}|`).join('\n')+'\n');
 console.log(JSON.stringify({count:categories.length,branches:new Set(categories.map(c=>c.pathIds[2])).size,directory,apiRequests:0}));return{context,categories};
}
if(import.meta.main)samplePlan().catch(e=>{console.error(String(e));process.exitCode=1;});
