import {hash} from '../runtime/store.ts';
/** Only explicitly shared IDs are merged. Same local names never imply equal meaning. */
export function registry(cards:any[]){
 const shared=new Map<string,any>(),local:any[]=[];
 for(const card of cards)for(const a of card.attributes){
  if(a.id.startsWith('common.')){
   const existing=shared.get(a.id);
   if(existing&&hash(existing)!==hash(a))throw Error('conflicting shared definition '+a.id);
   shared.set(a.id,a);
  }else local.push({categoryId:card.categoryId,definition:a});
 }
 return {shared:[...shared.values()],categoryScoped:local};
}
