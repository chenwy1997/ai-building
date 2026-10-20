import {expect,test} from 'bun:test';
import {normalizeCardContract} from '../domain/normalize-card.ts';
test('normalization updates every structured ID while preserving external quotes and values',()=>{
 const input={attributes:[{id:'cat.layerCount',name:'层数'}],bindings:[{attributeId:'cat.layerCount',condition:'cat.layerCount > 1'}],rules:[{attributeId:'cat.layerCount',formula:'cat.layerCount * 2'}],dimensions:[{attributeIds:['cat.layerCount']}],provenance:[{attributeId:'cat.layerCount',claims:[{sourceId:'source-x',quote:'原文cat.layerCount'},{sourceId:'model-knowledge',quote:'非外部引文'}]}]};
 const r=normalizeCardContract(input);expect(r.card.attributes[0].id).toBe('cat.layer_count');expect(r.card.dimensions[0].attributeIds).toEqual(['cat.layer_count']);expect(r.card.provenance[0].claims[0].quote).toBe('原文cat.layerCount');expect(r.card.provenance[0].claims[1].quote).toBe('');expect(input.attributes[0]!.id).toBe('cat.layerCount');expect(r.changes).toHaveLength(2);
});
test('ID collision stops normalization, missing common rule is never guessed',()=>{
 expect(()=>normalizeCardContract({attributes:[{id:'aB'},{id:'a_b'}]})).toThrow('collision');
 expect(()=>normalizeCardContract({attributes:[{id:'common.brand'}],bindings:[],rules:[],dimensions:[],provenance:[]})).toThrow('missing public rule');
});
