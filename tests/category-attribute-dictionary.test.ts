import { describe, expect, test } from 'bun:test';
import { seed } from '../src/scenarios/category_attributes_governance/dictionary/seed.ts';
import { compileSelections, fromStdText, toStdText, validateDictionary } from '../src/scenarios/category_attributes_governance/dictionary/contracts.ts';
import { candidateId, importSource, openInventory, search, statistics, storeDictionary } from '../src/scenarios/category_attributes_governance/dictionary/inventory.ts';
import type { Observation } from '../src/scenarios/category_attributes_governance/dictionary/inventory.ts';
const sample: Observation = {namespace:'jd',category:{id:'1',name:'电钻',path:['工具','电钻']},property:{name:'功率',values:['500W'],observed:1}};

describe('属性库的身份、出处与定义边界',()=>{
  test('属性名称命中优先于类目路径命中，结果可直接阅读',()=>{
    const db=openInventory(':memory:');
    try {
      const rows=[{...sample,category:{...sample.category,path:['功率计']},property:{name:'产地'}},sample];
      importSource(db,{label:'检索',kind:'test',path:'test',content:JSON.stringify(rows)},rows);
      expect(search(db,'功率',1).candidates[0]!.property.name).toBe('功率');
      expect(search(db,'功率',1).candidates[0]!.path).toEqual(sample.category.path);
    }finally{db.close();}
  });
  test('压缩是可逆序列化，保留定义全部字段',()=>{
    validateDictionary(seed);
    expect(fromStdText(toStdText(seed))).toEqual(seed);
    expect(toStdText(seed)).toBe(toStdText(structuredClone(seed)));
  });
  test('同名不同定义、对象、类目和命名空间不自动合并',()=>{
    const variants=[sample,{...sample,namespace:'sanheng' as const},{...sample,category:{...sample.category,id:'2'}},{...sample,property:{...sample.property,definition:'机械输出功率'}}];
    expect(new Set(variants.map(candidateId)).size).toBe(4);
  });
  test('重复导入不膨胀；保存原文、采样值和来源，不能转成封闭枚举',()=>{
    const db=openInventory(':memory:');
    try {
      const src={label:'来源',kind:'jd-observed',path:'/fixture',content:JSON.stringify([sample])};
      importSource(db,src,[sample]); importSource(db,src,[sample]);
      expect(statistics(db).observations).toBe(1);
      expect(statistics(db).contextualCandidates).toBe(1);
      const prop=JSON.parse((db.query('SELECT property FROM candidates_v1').get() as {property:string}).property);
      expect(prop).toEqual(sample.property); expect(prop.options).toBeUndefined();
      expect((db.query('SELECT content FROM sources_v1').get() as {content:string}).content).toBe(src.content);
      importSource(db,{...src,content:JSON.stringify({edition:2,rows:[sample]})},[sample]);
      expect(statistics(db).observations).toBe(2);
      expect(statistics(db).contextualCandidates).toBe(1);
    } finally{db.close();}
  });
  test('来源坏行事务回滚，不产生残缺导入',()=>{
    const db=openInventory(':memory:');
    try {
      expect(()=>importSource(db,{label:'坏来源',kind:'test',path:'test',content:'test'},[sample,{...sample,property:{name:''}}])).toThrow();
      expect(statistics(db).observations).toBe(0);
      expect(statistics(db).sources).toEqual([]);
    }finally{db.close();}
  });
  test('已有标准ID版本不能被静默重写',()=>{
    const db=openInventory(':memory:');
    try {
      storeDictionary(db,seed); storeDictionary(db,seed);
      const changed=structuredClone(seed);changed.properties[0]!.definition='变更定义';
      expect(()=>storeDictionary(db,changed)).toThrow('不可变更');
    }finally{db.close();}
  });
  test('标准编译拒绝物理量错误、未知概念和模型覆盖',()=>{
    const s={propertyId:'sh.electrical.insulation_resistance',revision:1,requirement:'optional' as const,rationale:'该类目有可识别的绝缘路径'};
    expect(compileSelections(seed,[s])[0]!.selectedUnitId).toBe('Mohm');
    expect(()=>compileSelections(seed,[{...s,unitId:'kV_per_mm'}])).toThrow();
    expect(()=>compileSelections(seed,[{...s,propertyId:'invented'}])).toThrow();
    expect(()=>compileSelections(seed,[{...s,name:'绝缘强度'} as typeof s])).toThrow('不允许覆盖');
    expect(()=>compileSelections(seed,[{...s,requirement:'conditional'}])).toThrow('适用条件');
    expect(()=>compileSelections(seed,[s,s])).toThrow('重复选择');
  });
  test('不同硬度标度与不同功率对象保持独立',()=>{
    const a=seed.properties.find(p=>p.id==='sh.material.shore_a')!;
    const b=seed.properties.find(p=>p.id==='sh.material.irhd')!;
    expect(a.quantity).not.toBe(b.quantity);
    const s={propertyId:a.id,revision:1,requirement:'optional' as const,rationale:'指定测试方法'};
    expect(()=>compileSelections(seed,[{...s,unitId:'irhd'}])).toThrow();
    const power=seed.properties.filter(p=>p.quantity==='power');
    expect(power).toHaveLength(2);expect(power[0]!.object).not.toBe(power[1]!.object);
  });
});
