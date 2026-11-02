import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { buildHardware } from '../src/scenarios/category_attributes_governance/dictionary/hardware/build.ts';
import { buildContextPacks } from '../src/scenarios/category_attributes_governance/dictionary/hardware/context.ts';
import { fromStdText, toStdText, compileSelections, digest } from '../src/scenarios/category_attributes_governance/dictionary/contracts.ts';
const path=resolve(import.meta.dir,'../src/scenarios/category_attributes_governance/workspace/reference/hardware30-expert-reference-v1/results.json');
// Integration tests use the frozen local reference, not paid AI requests.
const available=await Bun.file(path).exists();
describe.skipIf(!available)('五金30类知识包编译与回归',()=>{
  const text=available?require('node:fs').readFileSync(path,'utf8'):'';
  const pack=available?buildHardware(text):null!;
  const template=(name:string)=>pack.templates.find(t=>t.category.name===name)!;
  test('原类目身份和路径不变，所有原属性都有处置记录',()=>{
    const old=JSON.parse(text);
    expect(pack.templates.map(t=>t.category)).toEqual(old.map((c:any)=>c.category));
    for(const c of old) for(const a of c.attributes) {
      expect(pack.comparisons.filter(x=>x.categoryId===c.category.id&&x.sourceKey===a[0])).toHaveLength(1);
    }
    expect(pack.metrics.templateAttributes).toBe(pack.metrics.sourceAttributes-pack.metrics.removed+pack.metrics.added);
  });
  test('源资料发生变化会阻止自动采用',()=>{
    expect(()=>buildHardware(text+' ')).toThrow('重新审阅');
  });
  test('所有模板均可仅按固定属性ID重新编译，压缩可逆',()=>{
    for(const t of pack.templates)expect(compileSelections(pack.dictionary,t.selections)).toEqual(t.attributes);
    expect(fromStdText(toStdText(pack.dictionary))).toEqual(pack.dictionary);
  });
  test('硬度保留测试方法，应用承压参数和供应能力不混入本体属性',()=>{
    const ring=template('O形圈');
    expect(ring.applications.some(a=>a.sourceKey==='pressure_range')).toBe(false);
    expect(ring.attributes.find(a=>a.name==='硬度测试结果')!.qualifications.join(' ')).toContain('IRHD');
    expect(ring.attributes.some(a=>a.name==='胶料牌号')).toBe(true);
    for(const name of ['防爆六角套筒','抽屉式工具箱'])expect(template(name).applications.some(a=>a.sourceKey==='customizable')).toBe(false);
  });
  test('内部发热丝与外部引线、尺寸配合与工具插入长度各有对象',()=>{
    const core=template('热风枪发热芯');
    expect(core.attributes.find(a=>a.id==='sh.heater.external_lead_count')!.excludedMeanings).toContain('内部发热丝根数');
    expect(core.attributes.find(a=>a.id==='sh.configuration.sensor_type')!.requirement).toBe('conditional');
    const insert=template('梅花头插件');
    expect(insert.attributes.some(a=>a.name==='工作中心至安装基准距离')).toBe(true);
  });
  test('钉枪与水平尺保留独立条件，不把含混枚举当准则',()=>{
    const nailer=template('气动钉枪');
    const trigger=nailer.attributes.find(a=>a.name==='击发控制方式')!;
    expect(trigger.type).toBe('text');expect(trigger.definition).toContain('顺序击发');
    expect(nailer.attributes.some(a=>a.name==='声明耗气量')).toBe(true);
    expect(template('水平尺（工具）').attributes.find(a=>a.name==='测量允许误差')!.definition).toContain('测量姿态');
  });
  test('缓存知识包稳定，未夹带模板选配答案，构建不产生API请求',()=>{
    const contexts=buildContextPacks(pack);
    expect(digest(contexts)).toBe(digest(buildContextPacks(buildHardware(text))));
    for(const c of contexts){expect(c.prefix).not.toContain('"selections"');expect(c.prefixHash).toBe(digest(c.prefix));}
    expect(pack.metrics.apiRequests).toBe(0);
  });
});
