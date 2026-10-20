/** Repair only a dangling empty key token outside JSON strings. Never alter scalar text. */
export function parseOutput(text:string):{value:any;repairs:number}{
 try{return {value:JSON.parse(text),repairs:0};}catch{}
 let out='',quoted=false,escaped=false,repairs=0;
 for(let i=0;i<text.length;i++){
  const ch=text[i]!;
  if(!quoted&&ch===','){
   const match=/^,\s*"\s*(?=})/.exec(text.slice(i));
   if(match){i+=match[0].length-1;repairs++;continue;}
  }
  out+=ch;
  if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;}
  else if(ch==='"')quoted=true;
 }
 if(!repairs)throw new Error('invalid JSON; no safe normalization');
 return {value:JSON.parse(out),repairs};
}
export function normalizeSampleIds(samples:any[],knownIds:Set<string>){
 return samples.map(s=>{
  if(knownIds.has(s.productId))return s;
  const clean=s.productId.startsWith('sample-')?s.productId.slice(7):'';
  if(!knownIds.has(clean))return s;
  return {...s,productId:clean};
 });
}
export function usableWebText(text:string){
 return !(/Account\\?:[\s\S]{0,60}Password\\?:|Forgot password/i.test(text)&&/Sign in/i.test(text));
}
/** A model-knowledge marker is not an external quotation. Preserve raw responses
 * and record the rejected quote; never alter web/product/reference quotations. */
export function normalizeModelKnowledgeQuotes(input:any){
 const value=structuredClone(input),changes:{path:string;rejectedQuote:string}[]=[];
 const visit=(x:any,path:string)=>{
  if(!x||typeof x!=='object')return;
  if(Array.isArray(x.claims))for(let i=0;i<x.claims.length;i++){
   const c=x.claims[i];
   if(c?.sourceId==='model-knowledge'&&typeof c.quote==='string'&&c.quote){
    changes.push({path:path+'.claims['+i+'].quote',rejectedQuote:c.quote});c.quote='';
   }
  }
  for(const [k,v]of Object.entries(x))if(v&&typeof v==='object')visit(v,path+'.'+k);
 };
 visit(value,'$');return {value,changes};
}
