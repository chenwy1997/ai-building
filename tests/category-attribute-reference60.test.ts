import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReference } from '../src/scenarios/category_attributes_governance/dictionary/reference60/build.ts';
import type { Inputs } from '../src/scenarios/category_attributes_governance/dictionary/reference60/build.ts';
import { inputHashes } from '../src/scenarios/category_attributes_governance/dictionary/reference60/review.ts';
import { compileSelections, digest, fromStdText, toStdText } from '../src/scenarios/category_attributes_governance/dictionary/contracts.ts';
import { renderTemplates, renderSummary } from '../src/scenarios/category_attributes_governance/dictionary/reference60/entry.ts';
const root=resolve(import.meta.dir,'../src/scenarios/category_attributes_governance/workspace/dictionary/v1');
const available=Object.keys(inputHashes).every(k=>existsSync(resolve(root,k)));
describe.skipIf(!available)('60类参考版边界与回归',()=>{
 const inputs=Object.fromEntries(Object.keys(inputHashes).map(k=>[k,available?JSON.parse(readFileSync(resolve(root,k),'utf8')):null])) as Inputs;
 const p=available?buildReference(inputs):null!;
 const t=(name:string)=>p.templates.find(t=>t.category.name===name)!;
 const attr=(name:string,id:string)=>t(name).attributes.find(a=>a.id===id)!;
 test('原类目保持不变，所有60类有独立核对记录，旧定义版本保留',()=>{
  const before=[...(inputs['hardware30-v1/templates.json'] as any).templates,...(inputs['hardware-transfer30-v1/templates.json'] as any).templates];
  expect(p.templates.map(t=>t.category)).toEqual(before.map(t=>t.category));
  expect(p.templates.every(t=>t.reviewNote.length>15)).toBe(true);
  for(const old of (inputs['hardware-transfer30-v1/property-dictionary.json'] as any).properties)expect(p.dictionary.properties.find(x=>x.id===old.id&&x.revision===old.revision)).toEqual(old);
  expect(p.metrics.bindings).toBe(p.metrics.sourceBindings+p.metrics.addedBindings-p.metrics.removedBindings);
 });
 test('输入篡改和定义覆盖不能静默进入参考版',()=>{
  const bad=structuredClone(inputs);(bad['hardware30-v1/templates.json'] as any).templates[0].category.name='改名';expect(()=>buildReference(bad)).toThrow('冻结输入不匹配');
  const s=t('电锤').selections[0]!;expect(()=>compileSelections(p.dictionary,[{...s,name:'覆写'} as any])).toThrow('不允许覆盖');
 });
 test('范围问题不能被当成验收通过或进入试跑',()=>{
  expect(p.templates.filter(t=>t.status==='scope-held').map(t=>t.category.name).sort()).toEqual(['充电式草坪修剪机','组套工具盒','敲击背栓(三角卡)','绝缘滑套'].sort());
  for(const c of p.trialPlan.categories)expect(t(c.name).status).toBe('reference-ready');
  expect(p.issueResolutions.find(i=>i.name==='独立验收')?.outcome).toBe('independent-validation-pending');
  expect(p.trialPlan.execute).toBe(false);expect(p.trialPlan.thinking).toBe(false);
 });
 test('电池对象和接口输入输出方向有实质纠正',()=>{
  expect(attr('电锤','sh.hardware.tool_battery_voltage').definition).toContain('目标工具设计');
  expect(t('电锤').attributes.some(a=>a.id==='sh.battery.nominal_voltage')).toBe(false);
  expect(attr('电锤','sh.ref60.tool.chuck').object).toContain('输出端');
  expect(attr('棘轮扳手套装','sh.ref60.kit.drive_outputs').object).toContain('输出端');
  expect(attr('电动工具充电组套','sh.ref60.kit.battery_voltages').definition).toContain('逐电池型号');
  expect(attr('防爆套筒扳杆','sh.ref60.bar.output').object).toContain('输出端');
  expect(t('防爆套筒扳杆').attributes.some(a=>a.id==='sh.hw2.interface.drive')).toBe(false);
 });
 test('机器变体触发不同条件而非强求全类参数',()=>{
  expect(attr('液压式捣固机','sh.hw2.tamper.vibration').condition).toBe('通过连续振动进行捣固时');
  expect(attr('液压式捣固机','sh.ref60.tamper.blows').condition).toBe('通过往复击打进行捣固时');
  expect(attr('液压式捣固机','sh.hw2.tamper.track').requirement).toBe('conditional');
  expect(attr('热风枪发热芯','sh.heater.external_lead_count').condition).toBe('使用外部引线连接时');
  expect(attr('液压式轨缝调整器','sh.ref60.rail.pull').condition).toContain('拉伸');
  expect(attr('地漏','sh.hardware.floor_drain.water_seal_depth').condition).toBe('密封结构包含水封时');
 });
 test('非专业重复信息移出，基本尺寸缺项补齐',()=>{
  expect(t('组套工具箱').attributes.some(a=>a.id==='sh.hardware.tool_set.package_dimensions')).toBe(false);
  expect(t('羊毛刷').attributes.some(a=>a.id==='sh.hardware.wool_brush.origin')).toBe(false);
  expect(attr('弹簧夹','sh.ref60.clamp.throat').selectedUnitId).toBe('mm');
  expect(attr('工业美工刀','sh.ref60.knife.blade_fit').definition).toContain('厚度');
  expect(attr('剥线钳','sh.ref60.stripper.conductor').definition).toContain('绝缘');
 });
 test('可重复编译、最新定义压缩无损、可读输出覆盖60类',()=>{
  expect(digest(buildReference(inputs))).toBe(digest(p));
  expect(fromStdText(toStdText(p.activeDictionary))).toEqual(p.activeDictionary);
  for(const t of p.templates)expect(compileSelections(p.dictionary,t.selections)).toEqual(t.attributes);
  const md=renderTemplates(p);for(const t of p.templates)expect(md).toContain(t.category.id);
  expect(renderSummary(p)).toContain('自动语义评分器未实现');
 });
});
