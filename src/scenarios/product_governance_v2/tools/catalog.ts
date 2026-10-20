import type {Category,Source} from '../domain/meta.ts';
export function descendants(nodes:Category[],id:string){
 const root=nodes.find(n=>n.id===id);if(!root)throw new Error('Unknown category ID');
 const seen=new Set<string>(),result:Category[]=[];
 const visit=(n:Category)=>{if(seen.has(n.id))throw new Error('category cycle or duplicate');seen.add(n.id);result.push(n);for(const child of nodes.filter(x=>x.parentId===n.id))visit(child);};
 visit(root);return result;
}
export function ontology(nodes:Category[],standards:Record<string,string>,sources:Source[],card?:any){
 const required=(x:any)=>{if(!x)throw new Error('unknown reference');return x;};
 return {
  categories:{get:(id:string)=>required(nodes.find(n=>n.id===id)),leaves:(id:string)=>descendants(nodes,id).filter(n=>n.isLeaf)},
  standards:{read:(id:string)=>required(standards[id])},
  sources:{read:(id:string)=>required(sources.find(s=>s.id===id))},
  attributes:{definition:(id:string)=>required(card?.attributes.find((a:any)=>a.id===id)),rules:(id:string)=>required(card?.rules.find((r:any)=>r.attributeId===id))},
 };
}
