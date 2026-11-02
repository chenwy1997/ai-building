import { stableJson } from "./build.ts";
import { familyPolicies, numericUnitAliases, serviceFieldNames, compatibilityFieldNames, sharedSelectionFields, DELIVERY_KNOWLEDGE_VERSION } from "./delivery-knowledge.ts";
import type { DraftCategory, DraftDocument, KnowledgeProperty } from "./types.ts";
import { specificRequirements } from "./delivery-decisions.ts";

const setRequired = (p: KnowledgeProperty, reason: string) => { p.required = true; delete p.condition; delete p.requiredWhenApplicable; p.reason = reason; };
const conditional = (p: KnowledgeProperty, condition: string, reason: string) => { p.required = false; p.condition = condition; p.requiredWhenApplicable = true; p.reason = reason; };
const isService = (c: DraftCategory) => [...c.shared,...c.properties].some(p => ["服务商","服务提供方","服务提供商","服务内容","服务类型","服务区域","服务地点"].includes(p.name));
const describe = (p: KnowledgeProperty, text: string) => { if (!p.description?.includes(text)) p.description = [p.description,text].filter(Boolean).join("；"); };
const replaceField = (c: DraftCategory, oldNames: string[], property: KnowledgeProperty, review: string) => {
  const old = [...c.shared,...c.properties].filter(p => oldNames.includes(p.name));
  c.shared = c.shared.filter(p => !oldNames.includes(p.name));
  c.properties = c.properties.filter(p => !oldNames.includes(p.name));
  old.forEach(p => delete c.provenance[p.key]);
  c.properties.push({...property,scope:"category"});
  c.provenance[property.key] = {kind:"curated",sources:["codex-domain"],reviews:[review]};
  c.changes.push(`${oldNames.join("、")} → ${property.name}：${review}`);
};
const textField = (key: string, name: string, description: string, required = true): KnowledgeProperty => ({key,name,description,type:"text",unit:null,options:[],required,format:"按实际资料填写；未知待补，不填写猜测值"});

// No API calls. The source document is immutable; every applied decision is retained at field level.
export function refineForDelivery(source: DraftDocument, decisions = specificRequirements): DraftDocument {
  const out = structuredClone(source);
  const explicit=new Map<string,string[]>();
  for(const decision of decisions){
    const found=out.categories.filter(c=>c.category.path[1]===decision.domain&&c.category.name===decision.leaf);
    if(found.length!==1)throw new Error(`明确审定的类目绑定异常：${decision.domain}/${decision.leaf}，匹配${found.length}`);
    const category=found[0]!;
    for(const name of decision.fields)if(![...category.shared,...category.properties].some(p=>p.name===name))throw new Error(`明确审定缺少字段：${decision.leaf}/${name}`);
    explicit.set(category.category.id,decision.fields);
  }
  for (const c of out.categories) {
    const service = isService(c);
    const policies = familyPolicies.filter(p => p.domains.includes(c.category.path[1]!) && (!p.second || p.second.includes(c.category.path[2]!)));
    for (const p of [...c.shared,...c.properties]) {
      const before = stableJson(p), reviews: string[] = [], origin = c.provenance[p.key]!;
      // Preserve the earlier per-category authoring; broader family proposals only refine inherited fields.
      if (origin.kind === "historical-candidate") {
        if (p.name === "品牌" && !service) {
          setRequired(p,"建档需明确商品品牌状态；确认无品牌可填“无品牌”，未知待补。");
          p.description = "商品标示的品牌；不得以供应商、经销商名称替代品牌。确认无品牌填写“无品牌”，未知待补。";
          reviews.push("identity-brand");
        }
        if (["型号","系列或型号","规格型号"].includes(p.name) && !service) {
          conditional(p,"商品有制造商型号、系列号或货号时","记录可追溯的制造商标识；无型号商品由实际规格字段识别。");
          reviews.push("identity-model");
        }
        for (const family of policies) if (family.names.includes(p.name) && !service) {
          setRequired(p,family.reason); reviews.push(family.id);
        }
        if (!service && sharedSelectionFields.includes(p.name) && !p.condition && !p.required) {
          setRequired(p,"现有模板中的商品识别、规格、适配或额定能力字段，完整建档时按实际资料填写。");reviews.push("shared-selection-meaning");
        }
        if (serviceFieldNames.includes(p.name)) {setRequired(p,"服务建档需明确交付对象、范围、地点和履约条件；按合同约定填写。");reviews.push("service-contract");}
        if (compatibilityFieldNames.includes(p.name) && !service) {setRequired(p,"适配对象及接口/版本决定配件是否可用；按厂家兼容说明填写，不能仅凭同品牌推断。");reviews.push("compatibility");}
        if (["强度等级","性能等级"].includes(p.name) && c.category.path[1] === "五金工具") {
          conditional(p,"该产品的材料和执行标准采用该等级体系时","填写等级和标准体系；没有对应等级的产品不套用钢制紧固件等级。");reviews.push("fastener-grade");
        }
        if (["电池容量","电池能量","续航时间"].includes(p.name) && !service) {
          conditional(p,"交付物包含内置或随附电池时；不含电池的裸机除外","明确实际交付配置，续航同时记录测试工况。");reviews.push("battery-delivery");
        }
        if (["认证","认证信息","认证标准","认证编号","CCC认证","CCC强制性认证","MA认证","MA认证编号","注册证号","批准文号","生产许可证号","食品生产许可证号","防爆合格证号"].includes(p.name)) {
          conditional(p,"产品适用该准入要求，或商品资料明确声明该认证/批准时","仅依据有效证书、标签或官方记录填写，不从类目名称推定已获认证。");reviews.push("documented-approval");
        }
        if (c.category.path[1] === "照明" && ["色温","光通量","显色指数"].includes(p.name)) {
          conditional(p,"交付光源用于可见光照明且该指标适用时；红外、紫外及单色指示光源不套用白光指标","按实际光源种类和调光配置记录，不给特殊光源硬填白光参数。");reviews.push("lighting-photometry");
        }
      }
      // Identical unit spellings only; no scale conversion or reinterpretation of numerical product values.
      if (p.name === "净含量" && p.unit === "g/ml") {
        p.type = "text"; p.unit = null; p.format = "数值+单位；如质量或体积，套装注明单件净含量×数量";
        p.description = "每销售包装的净含量，按标签记录质量或体积单位；不得把 g/mL 密度当净含量。";p.example=null;reviews.push("net-content-dimension");
      }
      const previousUnit=p.unit;
      if (p.unit && numericUnitAliases[p.unit]) {p.unit=numericUnitAliases[p.unit]!;reviews.push("unit-spelling");}
      if(p.type==="number"&&p.example&&previousUnit&&p.example.endsWith(previousUnit)&&/^[-+]?\d+(\.\d+)?$/.test(p.example.slice(0,-previousUnit.length).trim())){p.example=p.example.slice(0,-previousUnit.length).trim();reviews.push("numeric-example");}
      if (p.unit === "DN" || p.unit === "PN") {
        const symbol=p.unit;p.type="text";p.unit=null;p.format=`${symbol}及其规格标识；不得直接当作测量值`;
        describe(p, symbol === "DN" ? "DN是公称尺寸标识，不等于实测内径" : "PN是公称压力标识；允许工作压力还取决于材料和温度");reviews.push("nominal-designation");
      }
      if (p.unit === "-kPa") {p.unit="kPa";describe(p,"明确为相对大气的表压还是绝压；负号属于表压数值，不属于单位");reviews.push("vacuum-pressure-basis");}
      if (p.unit === "速比") {p.unit=null;p.type="text";p.format="主动/从动比及表达方向，如5.2:1；无单位";reviews.push("dimensionless-ratio");}
      if (c.category.id === "dbb331ab-4c47-4dbd-87df-4f3164926808" && p.name === "分辨率") {p.unit=null;describe(p,"此处为pH示值分辨率，pH无量纲");reviews.push("ph-dimensionless");}
      if (["额定功率","功率","容量"].includes(p.name) && ["VA","kVA"].includes(p.unit??"")) {
        p.name="额定视在功率";p.description="电气额定视在功率；不能直接当作W/kW有功输出功率或电池能量。";reviews.push("apparent-power");
      }
      if (p.type === "number") {
        if(["精度","测量精度","准确度","温度均匀性","温度均匀度","控温精度","适用门厚","识别距离","头围"].includes(p.name)){
          p.type="text";p.format="保留区间、±或误差表达式及适用条件；单位见单位列";reviews.push("range-and-error-expression");
        }
        if(["34805433-286c-4a29-bc61-a100596748cd","0cee9294-2a19-4bc0-a4a7-2511194750d3"].includes(c.category.id)&&p.example?.startsWith(">")){p.type="text";p.format="保留实测值或界限符号及测试条件";reviews.push("reported-limit");}
        if(["2f0ce2be-03ce-4f35-beba-c6bf2325d875","47cca9df-3578-4b08-a0fe-cd3cf75496a4","9fb3f5ed-398d-409f-8b36-a71c15f2e7df"].includes(c.category.id)&&p.name==="公称直径"){
          p.type="text";p.unit=null;p.format="记录螺纹公称标识及尺寸体系，如M8；不是实测孔径";reviews.push("thread-nominal-designation");
        }
        if(["758be78f-1494-45c4-b16a-9cdce6eae559","79f7b0f2-d351-4df6-bc0d-ed8fb9e95b70","39782a8e-12c3-47a3-a157-01d144789fb0"].includes(c.category.id)&&["净重","显色指数"].includes(p.name)){
          p.example=null;p.format="填写实际单个数值；历史档位仅保留在来源中，不作为商品测量值";reviews.push("remove-unverified-bucket-example");
        }
        const suffix = p.unit;
        if (p.example && suffix && p.example.endsWith(suffix) && /^[-+]?\d+(\.\d+)?$/.test(p.example.slice(0,-suffix.length).trim())) {p.example=p.example.slice(0,-suffix.length).trim();reviews.push("numeric-example");}
        if(p.type==="number")p.format = "单个数值；单位由单位列给定，未知留空";
      } else if (p.type === "text") p.format ||= "开放文本；按实际资料填写";
      if (p.type === "boolean") p.format="true/false；未知留空，不得用false代替未知";
      if (stableJson(p)!==before) {origin.reviews=[...new Set([...(origin.reviews??[]),...reviews,DELIVERY_KNOWLEDGE_VERSION])];c.changes.push(`${p.name}：交付前校核（${reviews.length?reviews.join("、"):"填写格式"}）`);}
      if(explicit.get(c.category.id)?.includes(p.name)){
        setRequired(p,"按该末级类目的商品含义确认，为其关键规格、能力或服务交付信息。");origin.reviews=[...new Set([...(origin.reviews??[]),"explicit-leaf-selection"])];c.changes.push(`${p.name}：逐项检查后确认为核心建档项`);
      }
    }
    // Individually inspected semantic exceptions; original taxonomy IDs and paths are untouched.
    const forceNames: Record<string,string> = {
      "770c933a-1093-4586-8d13-2178d7db689c":"总压力",
      "3bf31f6b-56f1-486f-8d74-1e03884845e9":"公称压力",
      "22954821-0a2b-4604-9fb9-44a7cfaaa0a7":"公称压力",
      "c9fd36db-d15d-4e06-965a-f9244c05b44d":"公称压力",
      "6f0c9cb3-79cf-4156-b42b-a23eaab670da":"公称压力",
      "9e881b66-0d32-455b-9e54-1680e7f4f8e7":"最大扣压力",
    };
    const wrong=forceNames[c.category.id];
    if(wrong){const p=[...c.shared,...c.properties].find(p=>p.name===wrong);if(p){replaceField(c,[wrong],{...p,key:"rated_force",name:wrong==="最大扣压力"?"最大扣压力（力）":"额定压制力",unit:p.unit==="t"?"tf":p.unit,description:"作用在工件上的额定力；与液压系统工作压力分开记录。吨位若按吨力标示使用tf，不作为质量t。",required:true},"力与压力量纲分开");}}
    if(c.category.id==="de038e2a-2f83-4ef7-b7e9-36806e64e927"){
      const p=[...c.shared,...c.properties].find(p=>p.name==="容量");if(p)replaceField(c,["容量"],{...p,name:"可容纳文件厚度",description:"可容纳文件的总厚度；与外部盒脊宽度区分。",required:true},"用实际长度含义替代泛化容量");
    }
    if(c.category.id==="c0d08093-916a-4920-a647-6c508ec0a8a4")replaceField(c,["内径"],textField("thread_cutting_spec","加工螺纹规格","板牙加工的螺纹制式、公称直径、螺距或牙数及旋向；按完整标识填写。"),"板牙的加工螺纹规格不能用内径范围代替");
    if(["ccbc5472-b62c-4c3c-a715-b3a4401bfaa9","02c1b841-adc7-48c9-82a8-091c445af4ac"].includes(c.category.id)){
      const p=[...c.shared,...c.properties].find(p=>p.name==="容量");if(p)replaceField(c,["容量"],{...p,name:"可用安装高度",description:"机架可用安装高度，以U标示；与柜体外部高度区分。",required:true},"机柜容量明确为安装高度");
    }
    if(["可重复使用耳塞","一次性耳塞","头戴式耳罩","颈戴式耳罩","插帽式耳罩"].includes(c.category.name) && c.category.path[1]==="个人防护"){
      replaceField(c,["SNR降噪值","NRR降噪值","降噪值","降噪值(NRR)"],textField("attenuation_spec","降噪性能及测试依据","至少记录一种适用测试体系的衰减声明：指标名称（如SNR/NRR）、数值及测试依据；或分频段衰减数据。不同体系不直接等同，不把实验室值视为实际佩戴防护效果。"),"听力防护补足核心性能；测试体系保持独立");
    }
    // A service leaf had inherited pesticide product fields. Recompose it as a service, by exact original ID.
    if(c.category.id==="054b0ca6-1047-45d1-a142-69674adeba46"){
      c.shared=[];c.properties=[textField("provider","服务提供方","实际承接服务的机构或主体。"),textField("scope","服务内容与对象","区分油烟管道清洗、虫害防治等范围，列出对象和工作项目。"),textField("site","服务地点与作业范围","地点、面积/长度或设备数量及现场限制。"),textField("method","作业方案与交付内容","工作方法、所用材料和清运等交付范围，按约定填写。"),textField("schedule","服务时间与频次","单次或周期服务的时间、次数及响应约定。"),textField("acceptance","验收要求","可核验的交付清单及验收方式。")];c.provenance=Object.fromEntries(c.properties.map(p=>[p.key,{kind:"curated" as const,sources:["codex-domain"],reviews:["service-leaf-recomposition"]}]));c.treatment="curated-template";c.changes.push("原服务类目误配药剂产品字段，按服务交付重新编制");c.cautions=[];
    }
    if((c.category.path[1]==="办公用品"&&c.category.name==="涂料记号标识组/工业涂料卸货服务")||(c.category.path[1]==="办公设备"&&c.category.name==="搭建")||(c.category.path[1]==="五金工具"&&c.category.name==="弱电工程")){
      c.shared=[];c.properties=[textField("provider","服务提供方","实际承接作业的机构或主体。"),textField("scope","作业内容与范围","按原类目用途列明作业项目、对象及数量口径。"),textField("site","作业地点与现场条件","地址、作业面、进场条件及设备/材料限制。"),textField("schedule","履约时间","约定日期、周期或时段。"),textField("delivery","材料设备与交付清单","明确提供方、所含材料设备和数量；不含时说明。"),textField("acceptance","验收方式","约定可核验的完工记录及验收依据。")];
      c.provenance=Object.fromEntries(c.properties.map(p=>[p.key,{kind:"curated" as const,sources:["codex-domain"],reviews:["service-leaf-recomposition"]}]));c.treatment="curated-template";c.cautions=[];c.changes.push("按原类目所指服务重新编制，移除商品品牌/颜色等错误继承");
    }
    if(c.category.path[1]==="工控"&&c.category.name==="其它物联网系统方案"){
      replaceField(c,[],textField("solution_scope","方案范围与目标","需要连接的设备、采集/控制任务、现场规模及功能边界。"),"方案类目补交付边界");
      replaceField(c,[],textField("solution_components","软硬件组成","设备、软件、许可及数量，云服务订阅需注明周期。"),"方案类目补组成清单");
      replaceField(c,[],textField("solution_integration","接口与集成要求","协议、数据接口、网络方式及与现有系统的集成边界。"),"方案类目补系统适配");
      replaceField(c,[],textField("solution_acceptance","交付及验收要求","部署方式、交付物、验收测试及运维责任。"),"方案类目补验收范围");
    }
    if(c.category.path[1]==="办公设备"&&["会议室成套器材","市场部设备(音响/VR等)"].includes(c.category.name)){
      replaceField(c,["是否含显示设备","是否含视频会议","是否含音响系统"],textField("bundle_components","设备组成与数量","列明每项设备类型、型号、关键规格、数量及包含的连接附件。"),"以完整组成清单替代少量设备是否包含标志");
      replaceField(c,[],textField("integration_interfaces","配套连接与系统要求","音视频/控制接口、连接方式及软件授权等实际配套要求。"),"成套器材补系统兼容性");
    }
    if(c.category.path[1]==="清洁用品"&&c.category.name==="泄露应急处理套件"){
      replaceField(c,["含吸附棉","含手套","含收集袋"],textField("spill_kit_components","套件组成与数量","逐项填写吸附材料、防护用品及收集用品的名称、规格与数量。"),"避免三个布尔标志代替完整套装");
      replaceField(c,[],textField("spill_compatibility","适用泄漏介质","厂家声明适用及不适用的液体/化学品类别。"),"吸附量之外明确介质兼容性");
    }
    const addUnless = (equivalents: string[], field: KnowledgeProperty, reason: string) => {
      const existing=[...c.shared,...c.properties].find(p=>equivalents.includes(p.name)||p.key===field.key);
      if(!existing)replaceField(c,[],field,reason);
      else if(field.required&&!existing.condition&&!existing.required){setRequired(existing,reason);c.provenance[existing.key]!.reviews=[...new Set([...(c.provenance[existing.key]!.reviews??[]),"complete-existing-core"])];c.changes.push(`${existing.name}：${reason}`);}
    };
    if(service){
      addUnless(["服务商","服务提供方","服务提供商"],textField("service_provider","服务提供方","实际承担履约责任的机构或主体。"),"服务主体需明确");
      addUnless(["服务内容","服务范围","作业内容与范围","作业内容与数量"],textField("service_scope","作业内容与数量","明确服务对象、工作项目及数量/面积/设备范围，不能仅用服务类型代替具体范围。"),"补充可核验的服务范围");
      addUnless(["服务时间","服务期间","服务周期","服务期限","履约时间","服务时长"],textField("service_time","履约时间","按合同约定记录服务时间、周期或响应要求。"),"补充履约时间");
      addUnless(["验收标准","验收方式","验收要求","交付及验收要求"],textField("service_acceptance","验收要求","交付记录、数量/效果核对方式及完成确认依据，按约定填写。"),"补充服务验收依据");
    }
    if(c.category.path[1]==="五金工具"&&c.category.name==="拖把池龙头"){
      addUnless(["安装方式"],textField("mounting","安装方式","墙装、台装等实际安装形式及安装孔要求。"),"补足龙头安装适配");
      addUnless(["连接规格"],textField("connection_spec","连接规格","进水接口的螺纹制式、尺寸和连接形式。"),"补足龙头接口规格");
      addUnless(["控制形式"],textField("control_type","控制形式","阀芯/开关方式及单冷、冷热混水等实际配置。"),"补足龙头使用配置");
    }
    if(c.category.path[1]==="五金工具"&&c.category.name==="铝簸箕")addUnless(["外形尺寸"],{...textField("dimensions","外形尺寸","簸箕口宽、深度和总高度；注明尺寸口径。"),unit:"mm"},"补足容器尺寸");
    if(c.category.path[1]==="五金工具"&&c.category.name==="弹簧吊车")addUnless(["行程"],{key:"stroke",name:"行程",type:"number",unit:"m",required:true,options:[],description:"悬挂平衡器绳索的有效伸缩行程。",format:"单个数值"},"补足悬挂工具可达范围");
    if(c.category.path[1]==="实验室及化学用品"&&["基础化学试剂","其它化学试剂"].includes(c.category.name)){
      addUnless(["试剂名称"],textField("chemical_name","试剂名称","实际化学名称及形态；混合试剂记录产品名称及浓度规格。"),"泛化试剂类目必须明确物质身份");
      addUnless(["试剂等级"],textField("reagent_grade","试剂等级","按产品标签声明的质量等级或用途级别填写，不从纯度数值推断等级。"),"试剂等级与纯度分开");
      const cas=[...c.shared,...c.properties].find(p=>p.name==="CAS号");if(cas)conditional(cas,"物质有明确CAS登记号时","单一物质记录对应CAS号；混合物不编造单一CAS号。");
    }
    if((c.category.path[1]==="动力传动"&&c.category.name==="销售外购/动力传动")||(c.category.path[1]==="办公设备"&&["其他演示设备","其他行政设备","其他网络产品","其他打印机"].includes(c.category.name))||(c.category.path[1]==="生活福利"&&c.category.name==="适用年龄")){
      addUnless(["产品类型","设备类型","商品类型"],textField("product_kind","产品类型","原末级名称覆盖较宽，填写实际交付商品的具体类型。"),"明确泛化类目的交付对象");
      addUnless(["规格说明","规格","尺寸"],textField("selection_spec","规格说明","按实际产品记录关键尺寸、额定能力、接口或配置，注明名称和单位。"),"补足泛化类目的实际规格");
      addUnless(["交付清单"],textField("delivery_items","交付清单","销售包装内商品、配件或软件许可的名称、规格与数量。"),"明确实际交付范围");
      if(c.category.name==="适用年龄")c.cautions.push("原类目名称是年龄属性，不能唯一确定商品类型；模板保留原类目，以产品类型和规格说明承接实际商品。");
    }
    if(c.category.path[1]==="办公设备"&&c.category.name==="直播"){
      addUnless(["交付形态"],textField("delivery_type","交付形态","明确本条目销售的是直播设备、成套器材、软件许可还是服务。"),"原名称不足以确定单一商品形态");
      addUnless(["交付清单"],textField("delivery_items","交付清单","设备型号与数量、软件授权或具体服务范围。"),"按实际销售形态建档");
      const resolution=[...c.shared,...c.properties].find(p=>p.name==="分辨率");if(resolution)conditional(resolution,"交付物涉及视频采集、编码或显示时","注明输入、编码或显示端的分辨率口径。");
      c.cautions.push("原类目名称未明确设备或服务，需先填写交付形态，再填写适用的属性。");
    }
  }
  return out;
}

export function deliveryAudit(document: DraftDocument) {
  const rows=document.categories.flatMap(c=>[...c.shared,...c.properties]);
  const weak=document.categories.filter(c=>![...c.shared,...c.properties].some(p=>p.required&&!(["品牌","型号"].includes(p.name))));
  const conflicts=document.categories.flatMap(c=>{
    const ps=[...c.shared,...c.properties],seen=new Set<string>();
    return ps.flatMap(p=>{const issues:string[]=[];if(seen.has(p.name))issues.push("重复属性名");seen.add(p.name);if(p.required&&p.condition)issues.push("无条件必填与条件冲突");if(p.requiredWhenApplicable&&!p.condition)issues.push("条件必填缺少条件");if(p.type==="number"&&p.example&&!/^[-+]?\d+(\.\d+)?$/.test(p.example.trim()))issues.push("数值示例不是单个数值");return issues.map(issue=>({id:c.category.id,path:c.category.path,attribute:p.name,issue}));});
  });
  return {version:DELIVERY_KNOWLEDGE_VERSION,categories:document.categories.length,propertyRows:rows.length,required:rows.filter(p=>p.required).length,conditionalRequired:rows.filter(p=>p.requiredWhenApplicable).length,reviewedCategories:document.categories.filter(c=>Object.values(c.provenance).some(o=>o.reviews?.length)).length,reviewedFields:document.categories.reduce((n,c)=>n+Object.values(c.provenance).filter(o=>o.reviews?.length).length,0),conflicts,withoutSpecificRequired:weak.map(c=>({id:c.category.id,path:c.category.path,fields:[...c.shared,...c.properties].map(p=>p.name)})),scope:"全量结构与填写规则检查；不代表逐类供应商资料验收或监管认证"};
}
