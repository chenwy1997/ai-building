import {test,expect} from 'bun:test';
import {validateValue,validateEvidence,metrics,compareValue} from '../batch/validation.ts';
import {removeExtraClosers} from '../batch/model-json.ts';
test('语法恢复不改字符串内括号，不补截断内容',()=>{
 const text='{"products":[{"key":"W01","quote":"a}b"}},{"key":"W02"}}]}';
 const repaired=removeExtraClosers(text);expect(JSON.parse(repaired.text).products).toEqual([{key:'W01',quote:'a}b'},{key:'W02'}]);expect(repaired.removed.length).toBe(2);
 expect(()=>removeExtraClosers('{"products":[')).toThrow();
 expect(compareValue(['白色'])).toBe(compareValue('白色'));
});
test('单包数不可用零/小数或带单位文本冒充数值',()=>{
 const d={type:'数值',operator:'positive_integer_per_pack'};
 for(const v of [0,-1,12.5,'80片',Infinity])expect(validateValue(d,v).length).toBeGreaterThan(0);
 expect(validateValue(d,80)).toEqual([]);
});
test('颜色枚举外值保留为候选；多选比较与排列无关',()=>{
 expect(validateValue({type:'选项',enum:['白色','黑色'],selection:'多选'},['枪灰色'])).toEqual(['枚举外候选']);
 expect(compareValue(['黑色','白色'])).toBe(compareValue(['白色','黑色']));
});
test('未知不能用字符串否替代；真实false合法',()=>{
 expect(validateValue({type:'是否'},false)).toEqual([]);
 expect(validateValue({type:'是否'},'否').length).toBeGreaterThan(0);
});
test('不同商品或伪造引文无法通过证据校验',()=>{
 const p={id:'a',evidence:[{id:'T',productId:'a',text:'80片×4包'}]};
 expect(validateEvidence(p,'T','80片')).toEqual([]);
 expect(validateEvidence(p,'T','200片').length).toBeGreaterThan(0);
 expect(validateEvidence(p,'J','80片',[{id:'J',productId:'b',text:'80片'}]).length).toBeGreaterThan(0);
});
test('错挂/待确认从分母排除；枚举候选不计正式填充；0分母不伪装100%',()=>{
 const f=(s:string,required=true)=>({status:s,required});
 const rows=[{category:{status:'matched'},fields:{a:f('filled'),b:f('enum_candidate'),c:f('needs_evidence',false)}},{category:{status:'wrong'},fields:{a:f('filled')}},{category:{status:'uncertain'},fields:{a:f('filled')}}];
 expect(metrics(rows)).toMatchObject({sample:3,eligible:1,wrong:1,uncertain:1,slots:3,filled:1,required:2,requiredFilled:1,enumCandidates:1,complete:0});
 expect(metrics([]).fillRate).toBeNull();
});
