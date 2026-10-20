/** Structural/evidence checks; semantic entailment is reviewed separately. */
export function checkTrial(result:any,card:any,evidence:any[]):string[]{
 const errors:string[]=[],attrs=new Map<string,any>(card.attributes.map((a:any)=>[a.id,a]));
 if(result.values.length!==attrs.size||new Set(result.values.map((v:any)=>v.attributeId)).size!==attrs.size)errors.push('attribute coverage');
 const source=new Map<string,any>(evidence.map(e=>[e.id,e]));
 for(const v of result.values){
  const a=attrs.get(v.attributeId);if(!a){errors.push('unknown attribute '+v.attributeId);continue;}
  const b=card.bindings.find((b:any)=>b.attributeId===a.id);
  const error=(s:string)=>errors.push(a.id+': '+s);
  for(const e of v.evidence)if(!source.has(e.id)||!e.quote||!source.get(e.id).text.includes(e.quote))error('quote not in current product evidence');
  if(v.status!=='filled'&&v.value!=='')error('unverified status must not carry filled value');
  if(v.status==='not_applicable'&&b.requiredness==='always')error('required field cannot be not applicable');
  if(v.status==='filled'){
   if(!v.value||!v.evidence.length)error('filled without value/evidence');
   if(v.reasonCode!=='none')error('filled with missing reason');
   if(a.fieldType==='数值'&&(!/^-?\d+(\.\d+)?$/.test(v.value)||!Number.isFinite(Number(v.value))))error('numeric type');
   if(a.fieldType==='是否'&&!['true','false'].includes(v.value))error('boolean type');
   if(a.fieldType==='选项'&&v.enumStatus!==(a.enumValues.includes(v.value)?'in':'out'))error('enum status mismatch');
   if(a.fieldType!=='选项'&&v.enumStatus!=='not_enum')error('non enum status mismatch');
   const {operator,operands,formula}=v.calculation;
   if(operator!=='none'){
    if(operands.length!==2||!operands.every(Number.isFinite))error('calculation operands');
    else{
     const computed=operator==='divide'?operands[0]/operands[1]:operands[0]*operands[1];
     if(!Number.isFinite(computed)||Math.abs(computed-Number(v.value))>1e-8)error('calculation result mismatch');
     if(!formula)error('missing formula');
     if(operator==='divide'&&!Number.isInteger(computed))error('non-integer count division');
    }
   }
  }
 }
 return errors;
}
