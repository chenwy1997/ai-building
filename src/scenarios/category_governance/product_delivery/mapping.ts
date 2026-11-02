import { join } from "node:path";
import { fromStdText } from "../offline/codec.ts";
import type { KnowledgeProperty } from "../offline/types.ts";
import type { CategoryTreeDocument } from "../types.ts";
import { loadJson, saveJson, reproDir, sha256, type ProductInputs } from "./io.ts";
import type { PreparedProduct } from "./prepare.ts";
import type { ReviewGroup } from "./review.ts";
import { groupAssignmentsText, rowAssignmentsText, parseAssignments, parentAssignments, rowNotes, templateHash } from "./decisions.ts";

export const inputHash="5edb651b4401321edd654787b4118608049c6ca859eaee8dcbe1e39b41f4f522";
export interface MappedProduct extends PreparedProduct {
  category:{id:string;name:string;path:string[];isLeaf:boolean;index:number|null};
  mappingStatus:string; mappingNote:string; attributes:KnowledgeProperty[];
}
const scopeNotes:Record<number,string>={
  32:"京东SKU明确主体材质为塑料，采用塑料手推车；带围栏不等同于全金属承载平台。",
  44:"穿线润滑液，采用原库通用润滑剂类目。",103:"训犬隧道，原库无训练隧道细分，采用宠物用品下的玩具类目。",
  144:"原库缺通用轴流风机细分，采用商用风扇类目；工业通风用途。",181:"筛粉机按筛分仪功能归类，非筛网耗材。",
  211:"能源管理器属于电源控制附件，非电源芯片。",303:"野外淋浴箱组，原库无同名末级，采用辅助装备类目。",
  347:"本SKU型号为全金属线头+Profinet网线1米，按网线归类；PLC整机参数不采纳。",
  367:"开榫机采用锯切出榫，原库无开榫机细分，归入木工锯床，需确认类目适用范围。",
  413:"炊事挂车的灶头预热管配件，不能按完整炉灶填报。",436:"手用筛网采用原库筛网类目，非整台筛分设备。",
  449:"原库缺通用轴流排风机细分，采用商用风扇类目。",474:"销售规格明确不含主机，按弯管模具配件归类。",
  489:"消防柜亚克力门板，按柜体附件归类，非完整消防柜。",499:"气道管理训练模型为实体模拟训练器材，非临床手术器械。",
  525:"原库无可承接该普通车床的末级，暂挂原有金属加工上级；未伪造末级类目。",
  535:"外帘拉链头属于帐篷配件，非整顶帐篷。",565:"帐篷包装袋属于配件，80平方米为适配帐篷面积。",
  567:"SKU型号以扇叶结尾，按电机风叶暂归；需确认交付是否含风机总成，整机电参不采纳。",
  587:"以选定规格磷酸根分析仪归类；与硅酸根型号/包装信息冲突，保留核实事项。",
  632:"机械放线架暂采用卷线盘类目；原库缺同用途末级，电源插座卷盘参数不适用。",
  669:"仅有智能心理监护设备名称，暂采用其他智能设备类目，需补用途及资质说明。",
  695:"无菌导管柜属于医疗存储设施，采用病房硬件类目，非导管耗材。",
  703:"垃圾投放房按原有分类垃圾站归类。",
  709:"船用EVA碰垫采用EVA缓冲包装类目暂挂，原库缺船舶护舷细分。",
  723:"所选规格为空箱，不能填报急救药品或器械已配齐。",
  734:"帽壳仅写塑料，不能推断ABS/PP/PE；暂挂原有安全帽上级，等待具体材质。",
  745:"气动喷漆供料压力桶按压力罐归类；需确认原库压力罐包含喷涂用途。",
  759:"标题酸碱柜与选定60加仑防爆柜存在用途差异，采用通用安全柜，具体防护等级不推断。",
  782:"大理石精密测量基准平台采用量具附件类目，非办公桌。",
  791:"光纤识别/功率检测仪采用光缆计类目，非铜缆寻线仪。",
  798:"本行所选商品是洒水车水桶，按商用车零配件归类，非完整洒水车。",
  810:"伤情呈现组件是模拟训练用具，不按实际创面治疗耗材归类。",
  864:"彩钢屋面瓦采用原库防水瓦片类目承接，材质按商品资料填彩钢。",
};
const textProperty=(name:string,required=false):KnowledgeProperty=>({key:name,name,type:"text",required,description:"按本SKU已提供资料填写，不推断缺失的规格。"});
export async function buildMappings():Promise<MappedProduct[]>{
  const inputs=await loadJson<ProductInputs>(join(reproDir,"inputs.json"));
  if(inputs.sourceHash!==inputHash)throw new Error("测试集已变化，必须重新做语义归类决策，不能套用本次行号映射");
  const src=await Bun.file(join(import.meta.dir,"../workspace/output/v1/agent-delivery-v3/templates.std.json")).text();
  if(sha256(src)!==templateHash)throw new Error("属性模板快照变化，停止复用类目索引");
  const templates=fromStdText(src);
  const tree=await loadJson<CategoryTreeDocument>(join(import.meta.dir,"../workspace/context/v1/category-tree.json"));
  const nodes=new Map(tree.nodes.map(n=>[n.id,n]));
  const products=await loadJson<PreparedProduct[]>(join(reproDir,"products.json"));
  const groups=await loadJson<ReviewGroup[]>(join(reproDir,"review.json"));
  const groupMap=parseAssignments(groupAssignmentsText),rowMap=parseAssignments(rowAssignmentsText);
  const rowGroups=new Map(groups.flatMap(g=>g.rows.map(row=>[row,g] as const)));
  if(new Set(products.map(p=>p.sku)).size!==products.length||products.length!==inputs.products.length)throw new Error("商品SKU覆盖不一致");
  const originalByRow=new Map(inputs.products.map(p=>[p.row,p]));
  for(const p of products){const original=originalByRow.get(p.row);if(!original||["sku","title","variant","price"].some(k=>p[k as keyof PreparedProduct]!==original[k as keyof typeof original]))throw new Error(`商品与原表不一致 ${p.row}`);}
  const result=products.map(p=>{
    const group=rowGroups.get(p.row);
    if(!group||group.jdPath!==p.jdCategory.join("/"))throw new Error(`审阅分组不一致 ${p.row}`);
    const parentPath=parentAssignments[p.row];
    if(parentPath){
      const parent=tree.nodes.filter(n=>JSON.stringify(n.pathNames)===JSON.stringify(parentPath));
      if(parent.length!==1||parent[0]!.isLeaf)throw new Error("原上级类目不唯一");
      const n=parent[0]!;
      const names=p.row===734?["品牌","型号","帽壳材质","颜色","帽箍调节方式","下颏带","透气孔","执行标准"]:["品牌","型号","设备类型","控制方式","加工用途","额定功率","额定电压"];
      return {...p,category:{id:n.id,name:n.name,path:n.pathNames,isLeaf:false,index:null},mappingStatus:"暂挂上级，末级待确认",mappingNote:scopeNotes[p.row]!,attributes:names.map((name,i)=>textProperty(name,i<3))};
    }
    const index=rowMap.get(p.row)??groupMap.get(group.group);
    if(index===undefined)throw new Error(`未归类商品 ${p.row}`);
    const c=templates.categories[index]; if(!c)throw new Error(`无效类目索引 ${index}`);
    const node=nodes.get(c.category.id);
    if(!node?.isLeaf||JSON.stringify(node.pathNames)!==JSON.stringify(c.category.path))throw new Error(`原类目校验失败 ${p.row}`);
    return {...p,category:{...c.category,isLeaf:true,index},mappingStatus:scopeNotes[p.row]?.includes("暂")||scopeNotes[p.row]?.includes("原库")?"末级已挂载，范围待确认":"末级已挂载",mappingNote:scopeNotes[p.row]??rowNotes[p.row]??"依据本SKU标题、选定规格及京东详情，按实际售卖物归类。",attributes:[...c.shared,...c.properties]};
  });
  await saveJson(join(reproDir,"mapped-products.json"),result);
  await saveJson(join(reproDir,"category-decisions.json"),result.map(p=>({row:p.row,sku:p.sku,title:p.title,category:p.category,status:p.mappingStatus,note:p.mappingNote})));
  return result;
}
if(import.meta.main){
  const rows=await buildMappings();
  const start=Number(Bun.argv[2]??1),end=Number(Bun.argv[3]??1000);
  console.log(rows.filter(p=>p.row>=start&&p.row<=end).map(p=>`${p.row}|${p.category.path.at(-1)}|${p.title}`).join("\n"));
}
