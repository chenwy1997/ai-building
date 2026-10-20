import {resolve,join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {callModel,type ModelConfig} from '../adapters/models.ts';
const root=resolve(import.meta.dir,'../../../..');
const dir=join(root,'outputs/product-governance/three-category-20261019');
const legacy:any=await read(join(root,'outputs/clean-paper-remaining-20261016/attribute-model-all21.json'));
const names=['软包抽纸','湿纸巾','纸巾盒'];
const cats=legacy.categories.filter((c:any)=>names.includes(c.name));
const cfg:any=await read(join(import.meta.dir,'config.json'));
const payload={task:'为三个试点类目独立提出完整属性卡建议并审核历史卡的问题。仅设计，不填写商品。',
 constraints:['V2类目不改；公共定义与类目绑定分离；SKU取值，不推断SPU共享','字段类型只有文本、数值、是否、选项、日期；必填依据识别/采购/展示筛选价值，不依资料容易程度','每包抽数/片数与层数/总量区分；尺寸不能取厚度或外包装尺寸；颜色只取本体颜色','品牌引用可扩展企业品牌字典；不能只以五个示意品牌为封闭全集；适配品牌≠自身品牌','两个模型独立建议，Codex最终裁定，运营随机审核尚未进行','湿巾用途中记录湿厕纸、厨房清洁等差异；纸巾盒以完整容器为界，零件挂配件，避免把所有卷纸盒错判配件'],
 categories:cats.map((c:any)=>({id:c.id,name:c.name,path:c.path,boundary:c.boundary})),
 legacy:legacy.attributes.filter((a:any)=>names.includes(a.category)),
 output:{attributes:[{category:'公共或类目名',name:'',type:'',required:true,unit:'',enum:[],definition:'',scope:'',rule:'',rationale:'',source:'既有卡或模型建议'}],issues:[{category:'',attribute:'',problem:'',fix:''}],notes:[]},
 instruction:'每类总计建议10至15个有价值的属性，公共属性单列；无须为了凑数，避免医疗/认证无依据的强制字段。返回严格JSON，简洁。'};
await save(join(dir,'design/input.json'),payload);
await Promise.all(cfg.models.map(async(c:ModelConfig)=>{const r=await callModel(dir,'design-propose',c,payload);console.log(c.id,r.status,r.error??'',r.content?digest(r.content):'');}));
