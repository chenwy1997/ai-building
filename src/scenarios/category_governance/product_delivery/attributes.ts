import type { KnowledgeProperty } from "../offline/types.ts";
import type { MappedProduct } from "./mapping.ts";
import type { EvidenceField } from "./prepare.ts";
import { reviewedFacts, sourceExclusions, inapplicable } from "./facts.ts";
import { explicitFacts } from "./explicit-facts.ts";
import { semanticFacts } from "./semantic-facts.ts";
import { officialFacts } from "./official-facts.ts";

export interface Fact {name:string;value:string;unit?:string;source:string;quote:string;note?:string;priority:number}
export interface FilledAttribute {
  key:string;name:string;type:string;required:boolean;condition:string;unit:string;templateUnit:string;
  value:string|number|boolean|null;status:"已填写"|"待补充"|"资料冲突"|"不适用";
  source:string;quote:string;note:string;candidates?:Fact[];
}
const clean=(s:string)=>s.normalize("NFKC").replace(/\s+/gu," ").trim();
const nameKey=(s:string)=>clean(s).replace(/[（(][^()（）]*[)）]/gu,"").replace(/\s/gu,"").toLowerCase();
export const missingValue=(s:string)=>/^(?:其它|其他|其他品牌|其他型号|其它型号|其他系列|其它系列|未知|不详|未提供|未公布|无数据|暂无|待定|详见.*|见.*|以实物为准|咨询.*|定制|默认项|通用|\/?|-+|--|\/|null|undefined|N\/A)$/iu.test(clean(s));
const aliases:Record<string,string[]>={
  型号:["型号","京东检索型号","规格型号(MPN)","品牌零件号","机型"],
  规格型号:["规格型号","型号","京东检索型号"],规格:["规格","包装规格","京东尺寸"],
  材质:["材质","主体材质","主材质","机身材质","材料","柜体材质","杯身主体材质","主要材质"],
  颜色:["颜色","京东颜色"],尺码:["尺码","京东尺寸"],鞋码:["尺码","京东尺寸"],
  外形尺寸:["外形尺寸","产品尺寸","整机尺寸","机身尺寸"],尺寸:["尺寸","产品尺寸","京东尺寸"],
  产品尺寸:["产品尺寸","尺寸"],规格尺寸:["规格尺寸","产品尺寸","尺寸"],
  重量:["重量","产品净重","净重","产品重量","自重"],净重:["净重","产品净重","自重"],
  额定电压:["额定电压","电压","工作电压"],额定功率:["额定功率","功率"],功率:["功率","额定功率"],
  容量:["容量","容积"],容积:["容积","容量"],保质期:["保质期","保质期限"],
  厚薄:["厚薄","厚度"],面料材质:["面料材质","面料","材质"],面料:["面料","面料材质","材质"],
  柜体材质:["柜体材质","主体材质"],闭合方式:["闭合方式","衣门襟","穿着方式"],
  鞋面材质:["鞋面材质"],鞋底材质:["鞋底材质"],领型:["领型","领口"],
  净含量:["净含量","总净含量","净含量与包装","单件净重"],包装方式:["包装方式","包装形式"],
  包装形式:["包装形式","包装方式"],储存条件:["储存条件","储存方式","贮存条件"],储存方式:["储存方式","储存条件"],
  包装数量:["包装数量","包装规格","件数"],套装件数:["套装件数","件数"],
  包装组成:["包装组成","包装清单"],套装内容:["套装内容","包装清单"],套装包含:["套装包含","包装清单"],
  处理器型号:["CPU型号","处理器(CPU)","处理器型号"],CPU型号:["CPU型号","处理器(CPU)"],
  内存容量:["内存容量","运行内存"],运行内存:["运行内存","内存容量"],
  机身存储容量:["机身存储容量","存储容量","机身内存"],存储配置:["存储配置","硬盘容量"],
  显卡配置:["显卡型号","显卡","显卡类型"],预装操作系统:["系统","操作系统"],操作系统:["操作系统","系统"],
  最高刷新率:["屏幕刷新率","刷新率"],刷新率:["屏幕刷新率","刷新率"],
  屏幕面板类型:["屏幕材质","屏幕类型"],面板类型:["面板类型","面板"],
  屏幕分辨率:["屏幕分辨率","分辨率"],分辨率:["分辨率","屏幕分辨率"],
  最大有线充电功率:["充电功率"],支持无线充电:["无线充电"],支持NFC:["NFC","支持NFC"],
  内存规格:["内存规格","内存类型","内存频率"],网络配置:["无线网卡","网络配置"],
  接口类型:["接口类型","接口"],操控方式:["操控方式","控制方式"],控制方式:["控制方式","操控方式"],
  电源方式:["电源方式","供电方式"],供电方式:["供电方式","电源方式"],
  能效等级:["能效等级","能效标识"],能效标识:["能效等级","能效标识"],
  公称通径:["公称通径","公称直径"],公称直径:["公称直径","公称通径"],公称尺寸:["公称通径","公称直径"],
  螺纹类型:["螺纹类型","牙型"],长度:["长度","公称长度","总长度"],表面处理:["表面处理","涂层"],
  打印颜色:["打印颜色","颜色"],标称打印量:["单支打印页数","总打印页数","打印页数"],
  适用品牌:["适用打印机品牌","适用品牌"],适用型号:["适用型号","适用机型"],
  适配型号:["适配型号","适用型号","适用机型"],适用机型:["适用机型","适用型号"],
  芯片与识别配置:["是否带芯片"],厚度:["厚度","材质厚度"],
  最大承重:["最大承重","承重","安全承重"],锁具类型:["锁具类型","开锁方式"],
  适用年龄:["适用年龄","适用年龄段"],功能类型:["功能类型","功能"],
  是否可定制:["是否可定制","是否支持定制"],是否支持定制:["是否支持定制","是否可定制"],
  是否定制:["是否可定制","是否支持定制"],光源类型:["光源类型","灯源类型"],
  适用性别:["适用性别","性别"],适用场景:["适用场景","使用场景"],
  动力来源:["动力来源","供电方式"],
  光泽:["光泽","涂料光泽"],适用基材:["适用基材","适用范围"],
  纸张规格:["纸张规格","纸张尺寸","幅面"],支持纸张规格:["支持纸张规格","幅面"],
  六角尺寸:["六角尺寸","对边尺寸"],制式:["制式","公英制"],
  CAS号:["CAS号","CAS No.","CAS"],化学名称:["化学名称","学名"],
  上市年份:["上市年份","上市时间"],
  最大扫描幅面:["最大扫描幅面","最大幅面"],扫描类型:["扫描类型"],
  显示方式:["显示方式","显示类型"],光泽度:["光泽度","光泽","涂料光泽"],
  对边尺寸:["对边尺寸","六角尺寸"],公称长度:["公称长度","长度"],
  适用纸品类型:["适用纸品类型","适用纸巾类型"],试剂名称:["试剂名称","化学名称","学名"],
  印刷内容:["印刷内容","标识内容"],网线类别:["网线类别","线缆类别"],
  商品类型:["商品类型","配饰类型"],绝缘杆长度:["绝缘杆长度","长度"],验电方式:["验电方式","指示方式"],
  加工方式:["加工方式","加工工艺"],是否带脚轮:["是否带脚轮","是否带轮子","带轮子"],
};

// Only equivalent physical quantities convert. In particular Wh is not mAh,
// gauge/filter ranges are not SKU values, and package sizes are not product sizes.
const units:Record<string,[string,number]>={
  mm:["length",1],cm:["length",10],m:["length",1000],km:["length",1e6],毫米:["length",1],厘米:["length",10],米:["length",1000],
  g:["mass",1],kg:["mass",1000],克:["mass",1],千克:["mass",1000],公斤:["mass",1000],斤:["mass",500],吨:["mass",1e6],t:["mass",1e6],
  ml:["volume",1],l:["volume",1000],毫升:["volume",1],升:["volume",1000],
  w:["power",1],kw:["power",1000],瓦:["power",1],千瓦:["power",1000],v:["voltage",1],kv:["voltage",1000],
  a:["current",1],ma:["current",0.001],mah:["charge",1],ah:["charge",1000],wh:["energy",1],
  hz:["frequency",1],khz:["frequency",1000],mhz:["frequency",1e6],ghz:["frequency",1e9],
  gb:["storage",1],tb:["storage",1000],mpa:["pressure",1],kpa:["pressure",0.001],pa:["pressure",0.000001],bar:["pressure",0.1],
  英寸:["length",25.4],吋:["length",25.4],inch:["length",25.4],ms:["time",1],s:["time",1000],秒:["time",1000],
  月:["calendar_month",1],个月:["calendar_month",1],年:["calendar_month",12],天:["calendar_day",1],日:["calendar_day",1],
  度:["angle",1],"°":["angle",1],nm:["wavelength",1],纳米:["wavelength",1],"%":["percent",1],
};
const unitKey=(s:string)=>clean(s).replace(/\s/gu,"").toLowerCase();
const countUnits=/^(?:个|件|颗|只|支|双|张|包|盒|袋|瓶|层|卷|芯|路|口|位|针|孔|枚|页|套|块|台|顶|节)(?:[\/]\S+)?$/u;
export function normalizeNumeric(value:string,targetUnit:string,sourceUnit?:string):number|null{
  let s=clean(value).replace(/,/gu,"");
  if(/(?:以上|以下|约|小于|大于|≤|≥|[<>~～]|\d\s*[-—]\s*\d|[*×xX＋+；;])/u.test(s))return null;
  const m=s.match(/^([-+]?\d+(?:\.\d+)?)\s*([^\d]*)$/u);if(!m)return null;
  const n=Number(m[1]);if(!Number.isFinite(n))return null;
  const u=(m[2]?.trim()||sourceUnit||"");
  if(!u)return !targetUnit||countUnits.test(targetUnit)?n:null;
  if(unitKey(u)===unitKey(targetUnit))return n;
  const su=units[unitKey(u)],tu=units[unitKey(targetUnit)];
  if(su&&tu&&su[0]===tu[0])return Number((n*su[1]/tu[1]).toPrecision(12));
  if(countUnits.test(u)&&countUnits.test(targetUnit)&&(u.split("/")[0]===targetUnit.split("/")[0]||/^(?:个|件|颗|只|支|枚|片)$/u.test(u)&&/^(?:个|件|颗|只|支|枚|片)$/u.test(targetUnit)))return n;
  return null;
}
function boolValue(v:string):boolean|null{
  if(/^(否|不支持.*|无.*|不可.*|不能.*|不带.*|不含.*|不配.*|不.*防.*|非.*|false)$/iu.test(v))return false;
  if(/^(是|有|支持.*|可定制|可折叠|可调节|带.*|含.*|有.*|true)$/iu.test(v))return true;
  return null;
}
function fieldFact(f:EvidenceField):Fact{return{name:f.name,value:clean(f.value),source:f.source,quote:`${f.name}：${f.value}`,unit:f.name.match(/[（(]([^()（）]+)[)）]/u)?.[1],priority:/材质|面料/u.test(f.name)&&/\d\s*%/u.test(f.value)?96:f.source.startsWith("JD.param")?70:f.source==="JD.brandName"?95:f.source.startsWith("JD.category")?50:60};}

/** Parse repeated, unambiguous expressions; category choices remain authored decisions. */
export function titleFacts(p:MappedProduct):Fact[]{
  const facts:Fact[]=[];
  const put=(name:string,value:string,quote:string,source:string,unit?:string)=>facts.push({name,value,quote,source,priority:source==="原表.颜色尺寸"?90:80,...(unit?{unit}:{})});
  const clothing=/男装|女装|童装|内衣|服|衣|裤|T恤|套头衫|户外POLO|保洁/u.test(p.category.name)&&p.category.path.some(n=>["生活福利","运动相关"].includes(n));
  const footwear=/鞋|靴/u.test(p.category.name);
  const sources=[{s:p.variant,source:"原表.颜色尺寸"},{s:p.title,source:"原表.商品标题"}].filter(x=>x.s);
  const first=(name:string,pattern:RegExp,unit?:string)=>{for(const {s,source} of sources){const all=[...s.matchAll(new RegExp(pattern.source,pattern.flags.includes("g")?pattern.flags:pattern.flags+"g"))];const vals=[...new Set(all.map(m=>m[1]!))];if(vals.length===1){const m=all[0]!;const partial=name==="材质"&&s.slice(Math.max(0,(m.index??0)-1),m.index)==="含";put(name,partial?`含${vals[0]}（比例未提供）`:vals[0]!,partial?`含${m[0]}`:m[0],source,unit);return;}}};
  if(clothing||footwear){
    first("尺码",clothing?/(?:^|[^A-Za-z0-9])((?:\d{3}\/\d{2,3}[A-C]?)|(?:\dXL|XXXL|XXL|XL|XS|XXS|[SML])|(?:\d{3}(?:cm|CM))|均码|可调节)(?=$|[^A-Za-z])/gu:/(?:\/|\s|^)(\d{2}(?:\.5)?(?:码)?)(?=$|\s|码)/gu);
    if(footwear)first("鞋码",/(?:\/|\s|^)(\d{2}(?:\.5)?(?:码)?)(?=$|\s|码)/gu);
    if(clothing){
      first("袖长",/(短袖|长袖|无袖|七分袖|五分袖)/gu);
      first("领型",/(圆领|V领|翻领|立领|半高领|高领|POLO领)/giu);
      first("裤长",/(九分裤|七分裤|五分裤|长裤|短裤)/gu);
      first("服装类型",/(POLO衫|[Tt]恤|衬衫|卫衣|牛仔裤|休闲裤|西裤|羽绒服|毛呢大衣|羊毛衫|针织衫|风衣|夹克|西服|内裤|睡衣|文胸|短裤|套装)/gu);
      first("内衣类型",/(内裤|文胸|睡衣|保暖内衣|秋衣秋裤)/gu);
      first("适用季节",/(春秋|秋冬|春夏|四季|夏季|冬季|春季|秋季)/gu);
      first("版型",/(宽松|修身|直筒|阔腿|紧身)/gu);
    }
  }
  // Exact selected colour field is authoritative; do not extract a colour from a
  // numeric SKU option such as a bolt or from a list of available colours.
  const colour=p.fields.find(f=>f.source==="JD.color");
  if(colour&&!/[0-9]|可选|备注|款式|随机|见图|图片|其他|其它|定制|联系客服|咨询/u.test(colour.value)&&colour.value.length<26&&/[红橙黄绿青蓝紫黑白灰粉棕褐银金米杏咖卡其驼透明藏天]/u.test(colour.value))put("颜色",colour.value,`京东颜色：${colour.value}`,"JD.color");
  // Material is the sold object, never the substrate of a paint, cleanser or tool.
  if(!p.category.path.includes("实验室及化学用品")&&!/食品|食用|饮料|药|肤|护理|香皂|洗|茶|烘干|机械|刀|钻|锯/u.test(p.category.name)){
    first("材质",/((?:304|316L?|201)不锈钢|不锈钢(?:304|316L?|201)|聚四氟乙烯|PTFE|聚氨酯|丁腈|天然乳胶|硅橡胶|硅胶|紫铜|黄铜|铝合金|铸铁|铸钢|碳钢|涤纶|全棉|纯棉|棉100%|100%棉|全羊毛|纯羊毛|100%绵羊毛|桑蚕丝|莫代尔|尼龙|亚克力|牛皮|真皮|实木|不锈钢|塑料|玻璃|陶瓷|橡胶|帆布)/giu);
  }
  if(footwear)first("鞋面材质",/(牛皮|真皮|翻毛牛皮)/gu);
  first("尺寸",/(\d+(?:\.\d+)?\s*[*x×]\s*\d+(?:\.\d+)?(?:\s*[*x×]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|厘米|毫米))/giu);
  first("外形尺寸",/(\d+(?:\.\d+)?\s*[*x×]\s*\d+(?:\.\d+)?(?:\s*[*x×]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|厘米|毫米))/giu);
  first("额定电压",/(?:[^\d]|^)(\d+(?:\.\d+)?)\s*[Vv](?![A-Za-z])/gu,"V");
  if(!/电脑|手机|平板|充电|电池|照明|插座|插线板/u.test(p.category.name))first("额定功率",/(?:[^\d]|^)(\d+(?:\.\d+)?)\s*(?:W|w|瓦)(?![A-Za-z])/gu,"W");
  if(!/电池|电脑|手机/u.test(p.category.name))first("容量",/(?:[^\d]|^)(\d+(?:\.\d+)?)\s*(?:L|升)(?![A-Za-z])/gu,"L");
  first("电池容量",/(\d+(?:\.\d+)?)\s*mAh/giu,"mAh");
  first("屏幕尺寸",/(\d+(?:\.\d+)?)\s*(?:英寸|吋)/gu,"英寸");
  // Screw designation Mdiameter × length: do not treat a range or two options as
  // a single dimension; no thread pitch is inferred from the nominal diameter.
  if(p.category.path.includes("紧固件")){
    const s=p.variant||p.title;const m=s.match(/M(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)(?!\s*[*x×])/iu);
    if(m){put("螺纹规格",`M${m[1]}`,m[0],p.variant?"原表.颜色尺寸":"原表.商品标题");if(/螺钉|螺栓|螺柱/u.test(p.category.name))put("长度",m[2]!,m[0],p.variant?"原表.颜色尺寸":"原表.商品标题","mm");}
    first("性能等级",/(\d{1,2}\.\d)级/gu);
    first("执行标准",/((?:DIN\s*\d+|GB\/?T?\s*\d+(?:\.\d+)?)(?:-\d{4})?)/giu);
  }
  if(p.category.path.includes("金属管材管件")||p.category.path.includes("阀门"))first("公称通径",/\b(DN\s*\d+)\b/giu);
  // Quantities require explicit package wording. MOQ is not a package quantity.
  first("包装数量",/(\d+)\s*(?:个装|只装|件装|支装|片装|颗一包|粒装)/gu,"个");
  if(/套/.test(p.category.name)){
    first("件数",/(\d+)件套/gu,"件");
    for(const [word,n] of [["四件套","4"],["三件套","3"],["六件套","6"]])if(p.title.includes(word!))put("件数",n!,word!,"原表.商品标题","件");
  }
  first("UPF防晒指数",/(UPF\s*\d+\+?)/giu);
  first("防尘防水等级",/\b(IP\d{2}[A-Z]?)\b/gu);
  for(const f of facts.slice()){
    const copy:Record<string,string>={服装类型:"工装类别",容量:"容积",额定电压:"电压",额定功率:"功率"};
    if(copy[f.name])facts.push({...f,name:copy[f.name]!});
  }
  return [...facts,...explicitFacts(p),...semanticFacts(p)];
}

function candidateFacts(p:MappedProduct,a:KnowledgeProperty,title:Fact[]):Fact[]{
  const allowed=[...(aliases[a.name]??[a.name])];
  if(a.name==="材质"&&p.category.path.some(n=>/服|鞋|生活福利|运动相关/u.test(n)))allowed.push(...["面料材质","面料"] .filter(n=>!allowed.includes(n)));
  const skip=sourceExclusions[p.row]??[];
  const usableFields=p.fields.filter(f=>!skip.some(s=>(s==="*"&&f.source!=="JD.brandName")||s===f.name||s===f.source));
  const fields=usableFields.filter(f=>allowed.some(n=>nameKey(n)===nameKey(f.name))).map(fieldFact);
  const derived=title.filter(f=>allowed.some(n=>nameKey(n)===nameKey(f.name)));
  // Composite objects retain the named component instead of treating an upper,
  // lining or filling as the material of the entire product.
  if(a.name==="材质"&&/鞋|靴|毛绒玩具|茶具/u.test(p.category.name)){
    const fs=usableFields.filter(f=>/^(鞋面材质|鞋底材质|外套材质|填充物|茶杯材质|茶壶材质)$/u.test(f.name)&&!missingValue(f.value)&&!/^无/u.test(f.value));
    if(fs.length)fields.push({name:a.name,value:fs.map(f=>`${f.name}：${f.value}`).join("；"),source:fs.map(f=>f.source).join("；"),quote:fs.map(f=>`${f.name}：${f.value}`).join("；"),priority:92});
  }
  // Product dimensions whose axes are explicitly named can populate that axis.
  if(["长度","宽度","高度"].includes(a.name))for(const f of usableFields.filter(f=>/产品尺寸|外形尺寸/u.test(f.name))){
    const key=({长度:"长",宽度:"宽",高度:"高"} as Record<string,string>)[a.name]!;
    const m=f.value.match(new RegExp(`${key}(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)`));
    if(m)fields.push({...fieldFact(f),name:a.name,value:m[1]!,unit:m[2],quote:`${f.name}：${f.value}`});
  }
  if(a.name==="电池能量")for(const f of usableFields.filter(f=>/电池/.test(f.name)&&/Wh$/i.test(f.value)))fields.push({...fieldFact(f),name:a.name});
  // Compact combined specifications retain original subfield labels.
  const bundles:Record<string,string[]>={
    屏幕配置:["屏幕尺寸","屏幕分辨率","分辨率","屏幕类型","屏幕刷新率"],
    接口配置:["USB接口数","USB-C接口数量","显示端口","接口"],
    SIM配置:["SIM卡数量","SIM卡类型"],移动网络支持:["4G网络","5G网络"],
    摄像头配置:["后摄主像素","前摄主像素","后摄2-超广角像素","后摄3-tele像素"],
  };
  if(bundles[a.name]){
    const fs=usableFields.filter(f=>bundles[a.name]!.includes(f.name)&&!missingValue(f.value)&&!/[≤≥~～]|\d+-\d+(?:\.\d+)?英寸/u.test(f.value));
    if(fs.length)fields.push({name:a.name,value:fs.map(f=>`${f.name}：${f.value}`).join("；"),source:fs.map(f=>f.source).join("；"),quote:fs.map(f=>`${f.name}：${f.value}`).join("；"),priority:75});
  }
  return [...fields,...derived].filter(f=>!missingValue(f.value)).sort((x,y)=>y.priority-x.priority);
}
export function fillAttribute(p:MappedProduct,a:KnowledgeProperty,title=titleFacts(p)):FilledAttribute{
  const base:FilledAttribute={key:a.key,name:a.name,type:a.type,required:a.required,condition:a.condition??"",unit:a.unit??"",templateUnit:a.unit??"",value:null,status:"待补充",source:"",quote:"",note:a.condition?`适用条件：${a.condition}`:"现有资料未提供可确认值"};
  const na=inapplicable[p.row]?.[a.name];if(na)return{...base,status:"不适用",source:"Codex适用性判断",quote:p.title,note:na};
  const soldClothing=[...title].reverse().find(f=>/服装类型|内衣类型|工装类别/u.test(f.name))?.value??"";
  if(["袖长","领型"].includes(a.name)&&/裤|裙/u.test(soldClothing)&&!/套装|上衣|秋衣/u.test(soldClothing))return{...base,status:"不适用",source:"Codex适用性判断",quote:p.variant||p.title,note:"本SKU为下装，袖长和领型不适用。"};
  if(a.name==="罩杯"&&/内裤|秋衣秋裤|睡衣|保暖内衣/u.test(soldClothing))return{...base,status:"不适用",source:"Codex适用性判断",quote:p.title,note:"本SKU不是按罩杯尺码售卖的文胸。"};
  if(a.name==="垫子类别"&&/帐篷|遮阳棚/u.test(p.title))return{...base,status:"不适用",source:"Codex适用性判断",quote:p.title,note:"本SKU销售帐篷/棚体，非垫子。"};
  if(p.row===632&&["插座数量","额定电压","额定电流","额定功率","防护等级"].includes(a.name))return{...base,status:"不适用",source:"Codex适用性判断",quote:p.title,note:"实际交付为机械放线架，电源插座卷线盘参数不适用。"};
  if(p.row===44&&a.name==="NLGI稠度等级")return{...base,status:"不适用",source:"Codex适用性判断",quote:p.title,note:"NLGI稠度等级用于润滑脂；本品为穿线润滑液。"};
  if(a.name==="电池能量"&&["台式电脑","一体式电脑","服务器"].includes(p.category.name))return{...base,status:"不适用",source:"Codex适用性判断",quote:p.title,note:"本类整机不以随附电池供电；不将主板纽扣电池计入整机电池能量。"};
  if(a.name==="屏幕配置"&&p.variant.includes("单主机"))return{...base,status:"不适用",source:"原表.颜色尺寸",quote:p.variant,note:"选定规格为单主机，不含显示器。"};
  const manual=officialFacts[p.row]?.[a.name]??reviewedFacts[p.row]?.[a.name];
  if(manual){if(manual.value===null)return{...base,status:"资料冲突",source:manual.source??"Codex证据审阅",quote:manual.quote??p.title,note:manual.note??"资料不一致，需确认"};return{...base,value:manual.value,status:"已填写",source:manual.source??"原表.商品标题",quote:manual.quote??p.title,note:manual.note??"Codex根据本SKU资料核对"};}
  let candidates=candidateFacts(p,a,title);
  if(a.type!=="boolean")candidates=candidates.filter(f=>f.value!=="无");
  if(a.name==="品牌")candidates=candidates.filter(f=>f.source==="JD.brandName");
  if(/型号/.test(a.name)&&!/^适|^兼容/u.test(a.name))candidates=candidates.filter(f=>{
    if(!/[0-9]/u.test(f.value)||f.value.length>40||/烘干|腊肠|蒸车|全自动|宠物|零食/u.test(f.value))return false;
    if(/^\d{3,}$/u.test(f.value))return p.title.includes(f.value)||f.source.startsWith("JD.param");
    return /[A-Za-z]/u.test(f.value)&&!/^\d+(?:\.\d+)?\s*(?:[mMkK]?[gGlLmMvVwW]|mm|cm|kg|L|mL)$/u.test(f.value);
  });
  if(a.name==="颜色")candidates=candidates.filter(f=>!/[0-9]|其他|其它|[MmLlXx]{1,4}码|图片色|款式/u.test(f.value)&&f.value.length<35);
  if(["尺码","鞋码"].includes(a.name))candidates=candidates.filter(f=>f.value.length<30&&!/不同尺码|多尺码|联系客服|定制/u.test(f.value));
  if(a.type==="number"){
    const parsed=candidates.map(f=>({f,n:normalizeNumeric(f.value,base.unit,f.unit)})).filter(({n})=>n!==null&&n!==0);
    if(parsed.length){
      const best=parsed[0]!; const equalPriority=parsed.filter(c=>c.f.priority===best.f.priority);
      if(new Set(equalPriority.map(c=>c.n)).size>1)return{...base,status:"资料冲突",source:equalPriority.map(c=>c.f.source).join("；"),quote:equalPriority.map(c=>c.f.quote).join("；"),note:"同等来源提供了不同数值，未强行取一个",candidates:equalPriority.map(c=>c.f)};
      return{...base,value:best.n!,status:"已填写",source:best.f.source,quote:best.f.quote,note:best.f.note??(best.f.priority>=80?"采用本SKU明确规格":"采用京东SKU填报参数；按目标单位换算")};
    }
    // A calendar month is not 30 days and volume is not mass. Keep the label's
    // unit with the original template unit alongside it, rather than fabricate
    // a conversion or discard a valid source measurement.
    if(["保质期","净含量"].includes(a.name))for(const f of candidates){
      const m=clean(f.value).match(/^(\d+(?:\.\d+)?)\s*(个月|月|年|天|日|[mk]?g|[mM][lL]|[lL]|克|千克|公斤|毫升|升)$/u);
      const u=m?.[2]??f.unit;const raw=m?.[1]??f.value;
      if(u&&Number(raw)>0&&(a.name==="保质期"?/^(个月|月|年|天|日)$/u.test(u):/^(?:[mk]?g|[mM][lL]|[lL]|克|千克|公斤|毫升|升)$/u.test(u)))return{...base,unit:u==="个月"?"月":u,value:Number(raw),status:"已填写",source:f.source,quote:f.quote,note:`保留商品标签单位；模板默认单位为${base.templateUnit}，不可无依据换算。${f.note??""}`};
    }
    return{...base,source:candidates.map(f=>f.source).join("；"),quote:candidates.map(f=>f.quote).join("；"),note:candidates.length?"只有区间、单位不明或占位数值，不能当作本SKU准确数值":base.note,candidates:candidates.slice(0,3)};
  }
  if(a.type==="boolean"){
    const parsed=candidates.map(f=>({f,b:boolValue(f.value)})).filter(({b})=>b!==null);
    if(parsed.length){const x=parsed[0]!;return{...base,value:x.b!,status:"已填写",source:x.f.source,quote:x.f.quote,note:"仅依据资料明确的肯定或否定表述"};}
    return base;
  }
  if(a.type==="file")return base;
  if(!candidates.length)return base;
  const f=candidates[0]!;
  return{...base,value:f.unit&&!base.unit?`${f.value}${f.unit}`:f.value,status:"已填写",source:f.source,quote:f.quote,note:f.note??(f.priority>=80?"采用本SKU明确规格":"采用京东SKU填报参数" )};
}
