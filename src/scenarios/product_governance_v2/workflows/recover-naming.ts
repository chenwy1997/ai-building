/** Recover only identified serialization omissions from saved, billed responses. */
import {join,resolve} from 'node:path';
import {read,save} from '../runtime/store.ts';
import {validate} from '../domain/meta.ts';
const root=resolve(process.argv[2]!),dir=join(root,'revisions/closure-r3/naming-r1');
for(const [categoryId,callHash]of [
 ['15c851c5-7435-4843-8df6-4bd61dd3c1d5','15f3c1a5a5a885ff3c26f6ad9e15175da55b4399c84979da8ba0317706c50bf1'],
 ['c7e8d056-d834-4432-95a2-981e6e20e640','8d5ed4ff2ffc0f90a2ec9fb457b5515b9322af9623fcb4e6123810988e732000'],
]){
 const raw=await read(join(root,'calls',callHash!,'response.json')),request=await read(join(root,'calls',callHash!,'request.json'));
 let text=raw.output.flatMap((x:any)=>x.content??[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
 const repairs:any[]=[];
 if(categoryId==='c7e8d056-d834-4432-95a2-981e6e20e640'){
  const suffix=']}]},"summary":';
  if(text.split(suffix).length!==2)throw Error('unexpected syntax; no broad repair');
  text=text.replace(suffix,']}],"summary":');repairs.push('remove one premature root closing brace before summary');
 }
 const value=JSON.parse(text);
 for(const x of value.replacements){
  if(x.attribute.fieldType!=='选项'&&!('enumValues' in x.attribute)){x.attribute.enumValues=[];repairs.push({attributeId:x.attribute.id,rule:'non-option attribute has empty enumValues'});}
 }
 const errors=validate(request.body.text.format.schema,value);if(errors.length)throw Error(JSON.stringify(errors));
 await save(join(dir,'patches-final',categoryId!+'.json'),{value,responseModel:raw.model,responseId:raw.id,callHash,normalization:repairs});
}
