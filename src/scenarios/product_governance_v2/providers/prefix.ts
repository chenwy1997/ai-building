import {canonical,hash} from '../runtime/store.ts';

/** Keep every JSON value, including array order. Never promote source data into instructions. */
export function fixedPrefixInput(stage:string,input:any){
 const json=JSON.parse(JSON.stringify(input)),fixed:any={},dynamic:any={};
 // This order is intentional: category standards can be shared across stages.
 for(const key of ['candidates','card','cards','executionNotes','categoryId','stage','task']){
  if(key==='stage')fixed.stage=stage;
  else if(Object.hasOwn(json,key))fixed[key]=json[key];
 }
 for(const [k,v] of Object.entries(json))if(!Object.hasOwn(fixed,k))dynamic[k]=v;
 const prefix='{"fixedContext":{'+Object.entries(fixed).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'},"instance":';
 return {text:prefix+canonical(dynamic)+'}',prefixHash:hash(prefix),prefixCharacters:prefix.length};
}
