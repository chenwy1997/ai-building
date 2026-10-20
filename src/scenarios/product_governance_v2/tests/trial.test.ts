import {test,expect} from 'bun:test';
import {checkTrial} from '../trial/check.ts';
import {productText} from '../tools/jd-vop.ts';
test('trial values reject unsupported evidence, formula errors and fake enum coverage',()=>{
 const card={attributes:[{id:'count',fieldType:'数值',enumValues:[]}],bindings:[{attributeId:'count',requiredness:'always'}]};
 const evidence=[{id:'title',text:'4包共2000片'}];
 const v={attributeId:'count',status:'filled',value:'500',enumStatus:'not_enum',reasonCode:'none',evidence:[{id:'title',quote:'4包共2000片'}],calculation:{operator:'divide',operands:[2000,4],formula:'2000/4'}};
 expect(checkTrial({values:[v]},card,evidence)).toEqual([]);
 expect(checkTrial({values:[{...v,value:'2000'}]},card,evidence).join()).toContain('calculation result mismatch');
 expect(checkTrial({values:[{...v,evidence:[{id:'jd',quote:'500片'}]}]},card,evidence).join()).toContain('quote not in');
 expect(checkTrial({values:[{...v,status:'not_applicable',value:''}]},card,evidence).join()).toContain('required field');
});
test('text-only JD tool never imports image alt text or script contents',()=>{
 expect(productText('<p>尺寸10cm</p><img alt=\"红色\" src=\"x\"><script>材质PP</script>')).toBe('尺寸10cm');
});
