import {test,expect} from 'bun:test';
import {unitCandidates,checkUnitRoles} from '../domain/unit-roles.ts';
const card={attributes:[{id:'total',name:'销售总数量',fieldType:'数值'},{id:'count_unit',name:'销售数量单位',fieldType:'选项'},{id:'sales_unit',name:'交易单位',fieldType:'文本'}]};
const count={attributeId:'count_unit',role:'内容计数单位',quantityAttributeIds:['total'],reason:'配套销售总数量，说明数的是卷而非按箱计价'};
const sales={attributeId:'sales_unit',role:'交易销售单位',quantityAttributeIds:[],reason:'按箱计价'};
test('keywords select review candidates without deciding semantic roles',()=>{
 expect(unitCandidates(card).map((a:any)=>a.id)).toEqual(['count_unit','sales_unit']);
 expect(checkUnitRoles({attributes:card.attributes.slice(0,2)},[count])).toEqual([]);
});
test('true transaction roles are blocked in category attributes',()=>{
 expect(checkUnitRoles(card,[count,sales])).toEqual(['R11:sales_unit:transaction unit belongs to SKU base information']);
});
test('every candidate is reviewed and quantity links must be real numeric fields',()=>{
 expect(checkUnitRoles(card,[{...count,quantityAttributeIds:['missing']}]).join(';')).toContain('unknown or nonnumeric quantity');
 expect(checkUnitRoles(card,[count]).join(';')).toContain('sales_unit:unit role not reviewed');
 expect(checkUnitRoles({attributes:card.attributes.slice(0,2)},[count,count]).join(';')).toContain('duplicate unit role');
});
