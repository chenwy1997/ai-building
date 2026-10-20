import {join} from 'node:path';
import {read,save} from '../runtime/storage.ts';
import {AVAILABLE_MODELS,ROOT} from '../expansion/settings.ts';
import {invoke} from '../expansion/model-run.ts';
const run=join(ROOT,'outputs/product-governance/clean-paper-21-revision-20261019');
const model={...AVAILABLE_MODELS.find(m=>m.id==='glm')!,maxCalls:12};
const results=[];
for(const i of [1,2]){
 const original='cards-independent-'+i;
 const old:any=await read(join(run,'models',original+'-glm.json'));
 if(old.status!=='failed'||!old.error?.includes('native reasoning control thinking'))throw new Error('只重试已明确失败的参数不兼容请求');
 const payload:any=await read(join(run,'design',original+'.input.json'));
 const ids=new Set(payload.reviewedCategoryIds);
 const result=await invoke(original+'-protocol-r2',model,payload,v=>Array.isArray(v?.issues)&&v.reviewedCategoryIds?.length===ids.size&&v.reviewedCategoryIds.every((id:string)=>ids.has(id)),run);
 results.push({group:i,originalRecord:original+'-glm.json',transportChange:'OpenAI route仅reasoning_effort，移除原生thinking字段；端点及订阅不变',result});
}
await save(join(run,'review-glm-protocol-r2.json'),{model:'glm',results});
