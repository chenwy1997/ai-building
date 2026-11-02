import type { Fact } from "./attributes.ts";
import type { MappedProduct } from "./mapping.ts";

// Reusable, source-bound notation readers. These do not choose a category or
// invent technical specifications from a product family or a similar SKU.
export function explicitFacts(p:MappedProduct):Fact[]{
  const facts:Fact[]=[];
  const inputs=[{text:p.variant,source:"原表.颜色尺寸",priority:94},{text:p.title,source:"原表.商品标题",priority:83}];
  const put=(name:string,value:string,quote:string,x:typeof inputs[number],unit?:string,note?:string)=>facts.push({name,value,source:x.source,priority:x.priority,quote,unit,note});
  const unique=(name:string,re:RegExp,unit?:string)=>{for(const x of inputs){const ms=[...x.text.matchAll(re)];if(ms.length&&new Set(ms.map(m=>m[1])).size===1){put(name,ms[0]![1]!,ms[0]![0],x,unit);break;}}};
  const names=new Set(p.attributes.map(a=>a.name));
  const apparel=p.category.path.some(s=>/生活福利|运动相关|个人防护/u.test(s))&&/服|衣|裤|鞋|靴|裙|童装|男装|女装|帽|服饰/u.test(p.category.name);
  if(apparel){
    for(const x of inputs){
      const male=/(?:男童|男款|男士|男子|\(男\)|（男）|男装|男鞋|男女)/u.test(x.text),female=/(?:女童|女款|女士|女子|\(女\)|（女）|女装|女鞋|女靴|男女)/u.test(x.text);
      if(male||female||/中性/u.test(x.text)){put("适用性别",male&&female||/中性/u.test(x.text)?"中性":male?"男":"女",x.text,x);break;}
    }
    unique("适用身高",/(\d{3})\s*(?:cm|厘米)(?!\w)/giu,"cm");
    unique("鞋靴类型",/(过膝靴|短靴|烟筒靴|马丁靴|雪地靴|弹力靴|老爹鞋|跑步鞋|徒步鞋|板鞋|帆布鞋|洞洞鞋|凉拖鞋|凉鞋|拖鞋|皮鞋|浅口鞋|休闲鞋|运动鞋)/gu);
    unique("图案",/(纯色|条纹|条格|格纹|格子|迷彩|波点|印花|撞色)/gu);
    unique("闭合方式",/(套脚|系带|魔术贴|一脚蹬|拉链|纽扣)/gu);
    unique("定制类型",/(企业定制|公司定制|团体定制|来图定制|来样定制)/gu);
    unique("LOGO工艺",/(刺绣|丝印|热转印|烫印|印字)/gu);
  }
  // Read selected colour, including named shades; do not interpret "蓝牙" or
  // "白板" as a colour. A title only supplies a fallback if a colour phrase is explicit.
  const colourRe=/(曜金黑|大象灰|珍珠白|中国红|炭啡褐|土黄色|粉紫色|灰棕色|原木色|透明色|迷彩色|[深浅墨藏军酒砖宝天湖草豆卡米杏焦咖烟炭银玫香奶暖冷土橘桔粉]?[红橙黄绿青蓝紫黑白灰粉棕褐银金杏咖驼](?:色)|透明灰|藏青|藏蓝|卡其|迷彩|灰白|灰蓝|黑白|黑米|深绿|浅棕|雅黑|原木|透明)(?!牙|外|板|科技|光灯)/gu;
  for(const x of inputs){
    if(!names.has("颜色")||/可选|颜色备注|色号备注/u.test(x.text))continue;
    const words=[...new Set([...x.text.matchAll(colourRe)].map(m=>m[0]))];
    if(words.length===1){put("颜色",words[0]!,words[0]!,x);break;}
    if(/颜色随机|随机色|色随机|款式混发/u.test(x.text)){put("颜色","随机色",x.text,x,undefined,"资料明确随机发色，不承诺某个具体颜色。 ");break;}
  }
  if(names.has("材质")){
    unique("材质",/(玻璃纤维|聚酯纤维|铬钒钢|铬矾钢|冷轧钢板|镀锌钢板|高硼硅玻璃|玻璃钢|铁质|铝合金|聚丙烯|聚乙烯|聚氯乙烯|聚四氟乙烯|石墨|大理石)/gu);
    // Polymer abbreviations must be standalone, not part of a model number.
    unique("材质",/(?<![A-Za-z0-9])(PP|PVC|PC|ABS|PE|EVA|PTFE)(?![A-Za-z0-9])/gu);
  }
  unique("容量",/(\d+(?:\.\d+)?)\s*(?:ml|mL|毫升)(?!\w)/gu,"mL");
  unique("容积",/(\d+(?:\.\d+)?)\s*(?:ml|mL|毫升)(?!\w)/gu,"mL");
  unique("容量",/(\d+(?:\.\d+)?)\s*(?:mAh|毫安时)(?!\w)/giu,"mAh");
  unique("尺寸",/(\d+(?:\.\d+)?\s*[*×x]\s*\d+(?:\.\d+)?(?:\s*[*×x]\s*\d+(?:\.\d+)?)?\s*(?:m|米))(?![A-Za-z])/giu);
  unique("外形尺寸",/(\d+(?:\.\d+)?\s*[*×x]\s*\d+(?:\.\d+)?(?:\s*[*×x]\s*\d+(?:\.\d+)?)?\s*(?:m|米))(?![A-Za-z])/giu);
  // Named axes only: the order in an unlabelled 3D tuple varies by industry.
  for(const [name,word] of [["长度","长"],["宽度","宽"],["高度","高"],["厚度","厚"],["直径","直径"],["外径","外径"],["内径","内径"]]){
    for(const x of inputs){const re=new RegExp(`(?:${word})(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m|毫米|厘米|米)(?![A-Za-z])`,"giu");const ms=[...x.text.matchAll(re)];if(ms.length===1){put(name!,ms[0]![1]!,ms[0]![0],x,ms[0]![2]);break;}}
  }
  if(/电伴热带|灯串|线缆|电缆|水管|软管|网线|绳|铁链|扎带/u.test(p.category.name)){
    for(const x of inputs){const ms=[...x.text.matchAll(/(?<![\d.约])(?<n>\d+(?:\.\d+)?)\s*(?<u>m|米)(?![A-Za-z])/gu)];if(ms.length===1&&!/约\d+米/u.test(x.text)){put("长度",ms[0]!.groups!.n!,ms[0]![0],x,ms[0]!.groups!.u);break;}}
  }
  // Pack content keeps mass and volume separate. For one homogeneous multipack
  // the SKU total is calculated explicitly; mixed gift sets remain uncollapsed.
  if(names.has("净含量"))for(const x of inputs){
    const ms=[...x.text.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(kg|g|ml|mL|L|克|千克|公斤|斤|毫升|升)(?:\s*[*×x]\s*(\d+)\s*(袋|包|瓶|支|罐|盒)?)?(?![A-Za-z])/giu)];
    const vals=[...new Map(ms.map(m=>[m[0].toLowerCase(),m])).values()];
    if(vals.length===1){const m=vals[0]!;put("净含量",String(Number(m[1])*Number(m[3]??1)),m[0],x,m[2],m[3]?`按本SKU包装计算：${m[1]}${m[2]} × ${m[3]}${m[4]??"件"}。`:"采用商品明确净含量。");if(m[3])put("包装数量",m[3],m[0],x,m[4]??"个");if(m[4]&&/袋|瓶|罐|盒/u.test(m[4]))put("包装方式",`${m[4]}装`,m[0],x);break;}
  }
  // SKU package counts exclude ordering minima and recommended body weights.
  for(const x of inputs){
    const ms=[...x.text.matchAll(/(\d+)\s*(个|件|只|支|双|条|颗|片|粒|瓶|罐|袋|包|卷|张|盒)(?:装|\/盒|\/包|\/袋|\)|）|】|$)/gu)];
    if(ms.length===1&&!/起售|起订/u.test(ms[0]![0]))put("包装数量",ms[0]![1]!,ms[0]![0],x,ms[0]![2]);
  }
  const cn:Record<string,string>={一:"1",二:"2",两:"2",三:"3",四:"4",五:"5",六:"6",七:"7",八:"8",九:"9",十:"10"};
  for(const x of inputs){const m=x.text.match(/([一二两三四五六七八九十]|\d+)(层|格|位|槽)(?![\d米])/u);if(m){const n=cn[m[1]!]??m[1]!;const name=({层:"层数",格:"格数",位:"位数",槽:"槽数"} as Record<string,string>)[m[2]!]!;put(name,n,m[0],x,m[2]);}}
  const boolWords:Record<string,RegExp>={是否可定制:/可定制|支持定制|企业定制/u,是否可折叠:/可折叠|折叠式/u,是否可调节:/可调节|高度可调/u,是否防水:/防水/u,是否保温:/保温杯/u,是否带盖:/带盖|含盖|配盖/u,是否带轮:/带轮|带脚轮/u};
  for(const name of Object.keys(boolWords))if(names.has(name))for(const x of inputs){const m=x.text.match(boolWords[name]!);if(m&&!new RegExp(`(?:不|非|无)${m[0]}`).test(x.text)){put(name,"是",m[0],x);break;}}
  unique("口味",/(蒜香酸辣味|椒麻味|海苔味|香辣味|麻辣味|五香味|草莓味|白桃味|原味|芝士味|柠檬味|烧烤味)/gu);
  unique("包装方式",/(盒装|袋装|瓶装|罐装|桶装|礼盒装|整箱装|散装)/gu);
  unique("糕点类型",/(泡芙|蛋糕|蛋黄酥|面包|饼干|沙琪玛|桃酥)/gu);
  unique("锅具类型",/(蒸锅|炒锅|煎锅|汤锅|压力锅|高压锅|砂锅|奶锅|蒸煮两用锅)/gu);
  unique("用途",/(登山攀岩|维修|收纳|展示|办公|训练)/gu);
  return facts;
}
