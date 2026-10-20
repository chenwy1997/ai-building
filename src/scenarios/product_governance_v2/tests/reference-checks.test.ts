import {test,expect} from 'bun:test';
import {checkReferenceDecisions} from '../domain/reference-checks.ts';
test('reference decisions cover every source and retain exact imported facts',()=>{
 const sources=[{id:'row1',text:'是否印花；必填：是'},{id:'row2',text:'销售单位'}];
 const card={attributes:[{id:'surface'}],provenance:[{attributeId:'surface',claims:[{sourceId:'row1',quote:sources[0]!.text}]}]};
 const decisions=[{sourceId:'row1',action:'调整采纳',targetAttributeIds:['surface'],reason:'保留概念，三横采用可选',implementation:'复用现有表面工艺字段'},
 {sourceId:'row2',action:'不采纳',targetAttributeIds:[],reason:'交易主数据',implementation:'后续核对接口'}];
 expect(checkReferenceDecisions(card,decisions,sources)).toEqual([]);
 expect(checkReferenceDecisions(card,decisions.slice(0,1),sources).join()).toContain('missing decision');
 expect(checkReferenceDecisions(card,[...decisions,decisions[0]],sources).join()).toContain('duplicate');
 card.provenance[0]!.claims[0]!.quote='是否印花；必填：否';
 expect(checkReferenceDecisions(card,decisions,sources).join()).toContain('exact source row missing');
 card.attributes=[];
 expect(checkReferenceDecisions(card,decisions,sources).join()).toContain('deleted target');
});
