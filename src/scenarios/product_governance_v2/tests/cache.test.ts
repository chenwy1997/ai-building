import {test,expect} from 'bun:test';
import {fixedPrefixInput} from '../providers/prefix.ts';
import {groupedPending} from '../runtime/grouped.ts';
import {hash} from '../runtime/store.ts';
import {repairTargets,mergePatch} from '../trial/delta.ts';
test('stable prefix preserves all JSON values; products cannot fragment category prefix',()=>{
 const a={productId:'one',card:{b:[2,1],a:'中文'},task:'fill',evidence:[{id:'x',text:'actual'}],omit:undefined};
 const b={task:'fill',evidence:[{text:'other',id:'y'}],card:{a:'中文',b:[2,1]},productId:'two'};
 const p=fixedPrefixInput('stage',a),q=fixedPrefixInput('stage',b);
 expect(p.prefixHash).toBe(q.prefixHash);expect(p.text.slice(0,p.prefixCharacters)).toBe(q.text.slice(0,q.prefixCharacters));
 const parsed=JSON.parse(p.text);expect({...parsed.fixedContext,...parsed.instance}).toEqual({...JSON.parse(JSON.stringify(a)),stage:'stage'});
 expect(fixedPrefixInput('stage',{...a,card:{...a.card,b:[1,2]}}).prefixHash).not.toBe(p.prefixHash);
});
test('cached work skipped; two real warmups finish before group parallel work; groups isolated',async()=>{
 let active=0,max=0;const starts:string[]=[],ends:string[]=[];
 const rows=['a0','a1','b0','a2','a3','a4','b1','b2'];
 const result=await groupedPending(rows,x=>x[0]!,async x=>x==='a0',async x=>{
  if(x==='a2')expect(ends).toContain('a1');
  if(x==='a3'||x==='a4')expect(ends).toContain('a2');
  if(x==='b0')expect(ends).toContain('a4');
  starts.push(x);active++;max=Math.max(max,active);await Bun.sleep(2);active--;ends.push(x);
 },2);
 expect(result.skipped).toBe(1);expect(starts).not.toContain('a0');expect(max).toBe(2);expect(result.errors).toEqual([]);
});
test('invalid concurrency fails instead of hanging',async()=>{
 await expect(groupedPending([],()=>'',async()=>false,async()=>{},0)).rejects.toThrow('concurrency');
});
test('patch preserves untouched fields and metadata; rejects wrong scope, duplicates and stale bases',()=>{
 const base={productId:'p',category:{status:'matched'},values:[{attributeId:'a',value:'old'},{attributeId:'b',value:'keep'}],cardIssues:[]};
 const patch={productId:'p',baseHash:hash(base),values:[{attributeId:'a',value:'new'}]};
 const result=mergePatch(base,patch,['a']);expect(result.values[1]).toBe(base.values[1]);expect(result.category).toBe(base.category);
 expect(result.values[0].value).toBe('new');expect(base.values[0]!.value).toBe('old');
 expect(()=>mergePatch({...base,productId:'q'},patch,['a'])).toThrow('stale');
 expect(()=>mergePatch({...base,cardIssues:['new']},patch,['a'])).toThrow('stale');
 expect(()=>mergePatch(base,{...patch,values:[...patch.values,...patch.values]},['a'])).toThrow('scope');
 expect(()=>mergePatch(base,patch,['b'])).toThrow('scope');
});
test('repairs include quantity dependencies; unscoped errors require explicit review',()=>{
 const card={attributes:['common.brand','pieces_per_pack','mixed_pack','pack_components','total_pieces_sales_unit'].map(id=>({id})),rules:[]};
 expect(repairTargets(card,[],[{attributeId:'pieces_per_pack'}])).toEqual(['pieces_per_pack','mixed_pack','pack_components','total_pieces_sales_unit']);
 expect(repairTargets(card,['common.brand: quote not in current product evidence'],[])).toEqual(['common.brand']);
 expect(()=>repairTargets(card,['attribute coverage'],[])).toThrow('manual review');
});
