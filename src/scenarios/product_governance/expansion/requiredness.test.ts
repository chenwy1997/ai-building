import {test,expect} from 'bun:test';
import {resolveRequired,checkMeasurementGroups} from './requiredness.ts';
const p={id:'sku-a',evidence:[{id:'T',productId:'sku-a',text:'12包赠2包'}]};
const b={required:false,requiredWhen:{any:[{fact:'hasExplicitGiftComposition',equals:true}]}};
test('条件必填需当前SKU的真实引文',()=>{
 expect(resolveRequired(b,p,[{fact:'hasExplicitGiftComposition',value:true,evidenceId:'T',quote:'赠2包'}]).required).toBe(true);
 expect(resolveRequired(b,p,[{fact:'hasExplicitGiftComposition',value:true,evidenceId:'T',quote:'送3包'}]).required).toBe(false);
 expect(resolveRequired(b,p,[]).required).toBe(false);
});
test('既有业务必填不由条件缺证据降级',()=>expect(resolveRequired({required:true},p,[]).required).toBe(true));
test('二选一计量组需一条完整路径，不能用不适用冒充达标',()=>{
 const groups=[{id:'count-or-length',categoryId:'c',atLeastOne:[['count','unit','per'],['length']]}];
 expect(checkMeasurementGroups('c',{count:{status:'filled'},unit:{status:'filled'},per:{status:'filled'},length:{status:'not_applicable'}},groups)[0]?.complete).toBe(true);
 expect(checkMeasurementGroups('c',{count:{status:'needs_evidence'},unit:{status:'filled'},per:{status:'filled'},length:{status:'not_applicable'}},groups)[0]?.complete).toBe(false);
});
test('条件计量组分开明确不适用、未知和有矛盾的事实',()=>{
 const groups=[{id:'g',categoryId:'c',atLeastOne:[['count']],applicabilityRule:{fact:'counted',equals:true}}],fields={count:{status:'filled'}};
 const fact=(value:boolean)=>({fact:'counted',value,evidenceId:'T',quote:'12包'});
 expect(checkMeasurementGroups('c',fields,groups,p,[])[0]?.status).toBe('needs_evidence');
 expect(checkMeasurementGroups('c',fields,groups,p,[fact(false)])[0]?.status).toBe('not_applicable');
 expect(checkMeasurementGroups('c',fields,groups,p,[fact(true)])[0]?.complete).toBe(true);
 expect(checkMeasurementGroups('c',fields,groups,p,[fact(true),fact(false)])[0]?.complete).toBe(false);
});
