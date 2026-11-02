import type { KnowledgePack, KnowledgeProperty, KnowledgeSource } from "./types.ts";
import { applyRequirements } from "./requirements.ts";

// Semantic decisions live as versioned data. The compiler does not infer a product from keywords.
// Required flags below are proposed catalogue-entry requirements, not claims about law or JD rules.
export const KNOWLEDGE_VERSION = "codex-20260914-v2-required";
export const sources: KnowledgeSource[] = [
  { id: "codex-domain", kind: "domain-knowledge", title: "Codex 整理的商品选型知识", supports: "属性含义、适用范围与建模建议；属于可核查的知识提案，不冒充实测值或标准原文。" },
  { id: "eclass", kind: "standard", title: "ECLASS 属性结构", url: "https://eclass.eu/support/technical-specification/structure-and-elements/property", supports: "属性使用独立标识、定义、数据类型与计量单位；借鉴建模方法，未复制 ECLASS 授权属性库。" },
  { id: "skf-bearing", kind: "manufacturer", title: "SKF 深沟球轴承产品参数", url: "https://www.skf.com/rs/products/rolling-bearings/ball-bearings/deep-groove-ball-bearings/productid-6206-RZ", supports: "轴承内径、外径、宽度、动静额定载荷及转速字段；其他轴承型式的适用性另行判断。" },
  { id: "bossard-nut", kind: "manufacturer", title: "Bossard 六角螺母产品目录", url: "https://www.bossard.com/ch-en/eshop/hex-nuts/hex-nuts-type-1/p/21202/", supports: "材料、性能等级、表面涂层与执行标准分开表达；目录样例不形成全量枚举。" },
  { id: "iso-nut", kind: "standard", title: "ISO 4032 六角螺母标准摘要", url: "https://www.iso.org/standard/75016.html", supports: "六角螺母的螺纹、材料及产品等级；不把该标准强制套给所有螺母。" },
  { id: "festo-cylinder", kind: "manufacturer", title: "Festo DSBC 气缸目录", url: "https://festo.com/rep/en-us_us/assets/pdf/Standard_Cylinders_DSBC.pdf", supports: "缸径与行程为独立选型参数；不使用目录中的单一规格限制全部气缸。" },
  { id: "eppendorf-tip", kind: "manufacturer", title: "Eppendorf 移液吸头产品资料", url: "https://www.eppendorf.com/sg-en/Products/Lab-Consumables/Pipette-Tips/epDualfilterTIPS-p-PF-9246", supports: "吸头容量、过滤、纯净度与包装是不同维度。" },
  { id: "hikvision-camera", kind: "manufacturer", title: "海康威视网络摄像机规格", url: "https://www.hikvision.com/uk/products/IP-Products/Network-Cameras/Pro-Series-EasyIP-/ds-2cd2783g2-izs/", supports: "视频分辨率、焦距、供电、工作温度及防护等字段；可变焦焦距使用区间。" },
  { id: "philips-light", kind: "manufacturer", title: "Philips 灯具产品参数表", url: "https://www.assets.lighting.philips.com/is/content/PhilipsLighting/fp910500457091-pss-en_bg", supports: "功率、光通量、色温、显色指数分别建模；不将品牌专有光谱名称写为通用闭集。" },
  { id: "wika-leak", kind: "manufacturer", title: "WIKA GIR-10 气体检漏仪", url: "https://www.wika.com/media/Data-sheets/SF6-gas/Detection-instruments/ds_sp6202_en_co.pdf", supports: "泄漏率量程与最小可检泄漏率分开；厂家资料按工况注明单位。" },
];

const T = (key: string, name: string, description: string, required = false, unit: string | null = null, example?: string): KnowledgeProperty =>
  ({ key, name, type: "text", required, unit, options: [], description, ...(example ? { example } : {}) });
const N = (key: string, name: string, unit: string | null, description: string, required = false): KnowledgeProperty =>
  ({ key, name, type: "number", required, unit, options: [], description });
const B = (key: string, name: string, description: string): KnowledgeProperty =>
  ({ key, name, type: "boolean", required: false, unit: null, options: [], description, format: "true/false；未知留空，不能按 false 处理" });
const S = (key: string, name: string, options: string[], description: string): KnowledgeProperty =>
  ({ key, name, type: "single", required: false, unit: null, options, description });
const when = (p: KnowledgeProperty, condition: string): KnowledgeProperty => ({ ...p, required: false, condition });
const brand = T("brand", "品牌", "商品标示的品牌；无品牌时按实际记录，不从供应商名称推断。");
const model = T("model", "型号", "制造商完整型号或货号，保留区分规格的后缀。");
const material = T("material", "材质", "主要功能部件的材料或牌号；复合材料按部件分别填写。");
const color = T("color", "颜色", "实际交付商品的颜色或厂商色号，允许新增取值。");
const standard = T("standard", "执行标准", "厂家声明的标准编号及版本；只记录已知声明，不自动填入参考文献中的标准。");
const netWeight = N("net_weight", "净重", "kg", "商品本体净重，不含包装。");
const dimensions = T("dimensions", "外形尺寸", "本体长×宽×高；异形件注明各尺寸含义。", false, "mm", "长×宽×高");
const power = N("rated_power", "额定功率", "W", "铭牌额定输入功率，不能混用峰值或输出功率。");
const voltage = T("supply_voltage", "供电电压", "标注 AC/DC 及额定值或允许范围。", false, "V", "AC 220；DC 24；AC 100～240");
const temperature = T("operating_temperature", "工作温度范围", "允许连续工作的最低～最高环境温度。", false, "℃");
const thread = T("thread_spec", "螺纹规格", "完整螺纹代号，包含制式、公称规格及必要的螺距/牙数。", true, null, "M10×1.5；1/4-20 UNC");
const surface = T("surface_treatment", "表面处理", "实际镀层、涂层或表面工艺；未处理按实际填写。");
const strength = T("property_class", "性能等级", "按适用标准记录性能等级；非金属件或无等级产品可留空，不混用螺栓与螺母等级。");
const fitModels = T("compatible_models", "适配型号", "兼容设备的品牌、系列及完整型号；不得仅凭外观或接口相同推断兼容。");

// Exact aliases reviewed here apply only to the same semantic dimension.
// No diameter/DN, model/specification, power/voltage or strength/product-grade fuzzy merging.
export const commonDefinitions: Array<{ names: string[]; property: KnowledgeProperty }> = [
  { names: ["品牌"], property: brand }, { names: ["型号"], property: model },
  { names: ["颜色", "外观颜色", "机身颜色"], property: color },
  { names: ["净重", "产品净重", "商品净重"], property: netWeight },
  { names: ["执行标准"], property: standard },
  { names: ["表面处理"], property: surface },
  { names: ["显色指数", "显色指数Ra"], property: N("cri", "显色指数", null, "按厂家给出的 Ra 数值填写，无计量单位；其他显色指标注明体系。") },
  { names: ["光通量"], property: N("luminous_flux", "光通量", "lm", "指定工作条件下的额定光通量；不等于功率或照度。") },
  { names: ["pH值", "PH值"], property: T("ph", "pH值", "注明测量条件，允许单值或范围；pH 无计量单位。") },
];
export const platformOnlyFields = ["国补备案型号", "国补型号", "是否国补", "国家补贴", "京东价", "京东价格", "促销价", "商品评分", "好评率", "销量", "店铺名称", "店铺评分"];

const basePacks: KnowledgePack[] = [
  {
    id: "phone", title: "手机整机", leafNames: ["手机"], mode: "replace", sources: ["codex-domain"],
    reason: "手机按处理器、运行内存、存储、显示、网络与续航建模。京东样本可验证字段存在，样本机型和容量不作为封闭枚举。",
    properties: [brand, model,
      T("cpu_model", "处理器型号", "芯片厂商及完整型号，不填营销等级。", true),
      N("ram_gb", "运行内存", "GB", "物理 RAM 容量，不包含虚拟内存扩展。", true),
      N("storage_gb", "机身存储容量", "GB", "厂商标称内置存储容量，明确换算口径；不等于运行内存。", true),
      T("os", "操作系统", "系统名称及出厂版本。"), N("screen_inches", "屏幕尺寸", "英寸", "主屏幕对角线尺寸；折叠机注明内外屏。"),
      T("screen_resolution", "屏幕分辨率", "主屏横向×纵向像素；有实际像素时不用 1.5K 等宣传名称。", false, "px"),
      T("screen_panel", "屏幕面板类型", "面板技术名称；屏幕曲面形态不与面板材质混为一个枚举。"),
      N("refresh_hz", "最高刷新率", "Hz", "主屏支持的最高刷新率；自适应范围可在规格描述中注明。"),
      T("cellular", "移动网络支持", "支持的通信制式及频段；按实际销售区域版本填写。"),
      T("sim", "SIM配置", "实体 SIM 数量、卡型与 eSIM 支持，分别描述。"),
      N("battery_mah", "电池容量", "mAh", "记录厂商标称容量，注明典型值或额定值口径。"),
      N("charge_w", "最大有线充电功率", "W", "手机支持的输入充电功率，不直接等同于附送充电器额定输出。"),
      T("charge_port", "充电接口", "机身物理充电接口。"), B("wireless_charge", "支持无线充电", "按此销售版本实际能力填写。"),
      B("nfc", "支持NFC", "按此销售版本实际能力填写。"),
      T("camera", "摄像头配置", "前后摄分别填写主摄像素、镜头及防抖；不强制所有机型有长焦或超广角。"),
      T("ip_rating", "防尘防水等级", "厂家声明的 IP 等级及适用条件；未声明留空。"), color,
    ],
  },
  {
    id: "computer", title: "个人电脑整机", paths: [["办公设备", "电脑及电脑配件", "电脑整机"]], leafNames: ["组装电脑", "笔记本电脑", "台式电脑", "工作站", "一体式电脑", "F系列独立主机", "G系列独立主机"], mode: "replace", sources: ["codex-domain"],
    reason: "保留整机采购的关键配置，屏幕、电池仅用于相应形态；服务器和平板另保留其候选模板。",
    properties: [brand, model,T("cpu", "处理器型号", "完整 CPU 型号及数量。", true), N("ram", "内存容量", "GB", "实际安装物理内存总容量。", true),T("ram_spec", "内存规格", "内存代际、速率、插槽与 ECC 支持按配置填写。"),T("storage", "存储配置", "逐块记录 HDD/SSD 类型、接口、容量和数量，不把多块盘合成不明口径的容量。", true),T("gpu", "显卡配置", "集成/独立图形方案及型号；独立显存单独注明。"),T("os", "预装操作系统", "系统版本、授权类型；未预装按实际记录。"),T("ports", "接口配置", "接口协议、规格及数量。"),T("network", "网络配置", "有线网口、Wi-Fi、蓝牙支持。"),when(T("screen", "屏幕配置", "尺寸、分辨率、刷新率。"),"笔记本、一体机或随主机交付显示器时"),when(N("battery", "电池能量", "Wh", "标称电池能量；不等同于续航时间。"),"含内置电池的整机"),dimensions,netWeight],
  },
  {
    id: "threaded-nut", title: "螺母的通用选型属性", paths: [["五金工具", "紧固件", "螺母"]], mode: "augment", sources: ["bossard-nut", "iso-nut"],
    reason: "螺纹、材料、性能与表面工艺分开。保留各叶类特有的铆接尺寸、锁紧结构等候选字段。",
    properties: [brand,model,thread,material,strength,surface,standard], removeNames: ["螺纹尺寸", "螺纹", "强度等级", "性能级别", "螺纹类型", "螺纹制式", "螺距"],
  },
  {
    id: "hex-nut", title: "六角螺母", leafNames: ["六角螺母", "六角薄螺母", "六角厚螺母", "小六角特薄细牙螺母", "矮型六角盖形螺母", "六角盖形螺母"], mode: "replace", sources: ["bossard-nut", "iso-nut"],
    reason: "用实际螺纹和尺寸识别规格，等级保留标准上下文；螺母不是螺栓，不能套用 8.8 这样的螺栓等级。",
    properties: [brand,model,thread,material,strength,surface,standard,N("height", "螺母高度", "mm", "按图纸标注的总高或厚度，盖形结构注明测量位置。"),N("across_flats", "对边宽度", "mm", "六角相对平面的距离。"),S("thread_direction", "螺纹旋向", ["右旋","左旋"], "本模板适用单一旋向的六角螺母；按实际标注选择，未知留空。")],
  },
  {
    id: "hex-bolt", title: "通用六角螺栓", paths: [["五金工具", "紧固件", "螺栓"]], leafNames: ["外六角螺栓", "六角头螺栓", "六角法兰面螺栓", "重型外六角螺栓", "8.8级螺栓"], mode: "replace", sources: ["codex-domain"],
    reason: "只绑定核实为螺栓的末级项，父节点中的平垫、化学管、配件不继承螺栓属性。",
    properties: [brand,model,thread,N("length", "公称长度", "mm", "按产品标准规定的基准测量，不随意混用全长。",true),material,strength,surface,standard,T("thread_length", "螺纹长度形式", "全螺纹/部分螺纹及实际有效螺纹长度。"),N("across_flats", "头部对边宽度", "mm", "六角头对边尺寸。")],
  },
  {
    id: "flat-washer", title: "平垫圈", leafNames: ["平垫"], mode: "replace", sources: ["codex-domain"],
    reason: "按商品对象识别为垫圈，保留原树中的螺栓父节点。垫圈没有螺距、螺纹长度或螺纹旋向。",
    properties: [brand,model,N("inner_diameter", "内径", "mm", "垫圈中心孔直径。",true),N("outer_diameter", "外径", "mm", "垫圈外轮廓直径。",true),N("thickness", "厚度", "mm", "垫圈轴向厚度。",true),material,surface,T("hardness", "硬度", "硬度数值及 HV/HRC 等试验标尺。"),standard],
  },
  {
    id: "rolling-bearing", title: "滚动轴承", paths: [["动力传动","轴承及其工具","球轴承"],["动力传动","轴承及其工具","滚子轴承"],["动力传动","轴承及其工具","滚针轴承"]], excludeNames: ["滚子轴承随动器"], mode: "augment", sources: ["skf-bearing"],
    reason: "以完整代号和主要安装尺寸为核心。径向轴承宽度与推力轴承高度的名称按图纸解释，动静载荷不合并。",
    removeNames: ["型号", "内径", "孔径", "外径", "轴承宽度", "额定动载荷", "额定静载荷", "精度等级", "密封形式", "游隙组别", "游隙等级", "尺寸公差", "额定载荷"],
    properties: [brand,T("bearing_designation", "轴承代号", "完整轴承代号及密封、游隙、精度等后缀。",true),N("bore", "轴承内径", "mm", "轴承内圈孔径；圆锥孔注明锥度。",true),N("outside", "轴承外径", "mm", "按该型式图纸定义的主要外径。",true),N("width", "轴承宽度或高度", "mm", "径向轴承记录宽度；推力轴承记录组合高度，并注明尺寸符号。",true),T("clearance", "游隙或预载", "记录制造商游隙组别或预载级别；两者不可混同。"),T("precision", "公差等级", "完整公差等级及适用体系。"),N("dynamic_rating", "基本额定动载荷", "kN", "厂家标称 C，注明径向或轴向。"),N("static_rating", "基本额定静载荷", "kN", "厂家标称 C0，注明径向或轴向。"),T("seal", "密封防尘结构", "开放式、密封圈或防尘盖及实际代号。")],
  },
  {
    id: "timing-belt", title: "同步带", paths: [["动力传动","皮带","齿形同步带"]], mode: "replace", sources: ["codex-domain"],
    reason: "同步带互换需要齿形、节距、节线长度与带宽，不能仅看外周长。",
    properties: [brand,model,T("tooth_profile", "齿形代号", "完整齿形系列，按制造商规格填写。",true),N("pitch", "节距", "mm", "相邻齿在节线上的间距。",true),N("pitch_length", "节线长度", "mm", "同步带节线长度，不是外周长。",true),N("belt_width", "带宽", "mm", "实际带体宽度。",true),N("teeth", "齿数", null, "整条闭合带的齿数；开口带按交付形式注明。"),T("body_material", "带体材质", "带体材料，不与芯线材料混同。"),T("cord_material", "芯线材质", "增强芯线材料。"),T("construction", "带体结构", "开口/闭合、单面/双面齿按实际结构填写。")],
  },
  {
    id: "earplug", title: "防噪声耳塞", leafNames: ["可重复使用耳塞","抛弃型耳塞"], mode: "replace", sources: ["codex-domain"],
    reason: "降噪指标需区分 SNR 与 NRR。分配器不继承耳塞性能，未知降噪值不能从常见商品估计。",
    properties: [brand,model,material,T("size", "尺寸规格", "耳塞的尺寸或适配耳道规格，按厂家标注。"),B("corded", "是否带线", "交付形式是否带连接线。"),T("reuse", "使用形式", "一次性或可重复使用，需与本类目定义一致。"),N("snr", "SNR降噪值", "dB", "按厂家报告的 SNR 指标填写，未提供留空；不可直接换算为 NRR。"),N("nrr", "NRR降噪值", "dB", "按厂家报告的 NRR 指标填写，未提供留空。"),standard,T("pack", "包装规格", "每包装的耳塞对数、独立包装和配套收纳说明。")],
  },
  {
    id: "warm-earmuff", title: "保暖耳罩", leafNames: ["保暖耳罩"], mode: "replace", sources: ["codex-domain"],
    reason: "保暖用品不默认具有听力防护能力；原分类位置不变。",
    properties: [brand,model,T("outer_material", "面料材质", "外层面料材质。"),T("lining", "内衬材质", "贴肤内衬与填充材料。"),T("size", "佩戴尺寸", "适配头围或尺寸范围。"),T("wearing", "佩戴方式", "实际佩戴结构。"),B("adjustable", "是否可调节", "佩戴长度或围度是否可调节。"),color],
  },
  {
    id: "anti-slip-cover", title: "防滑鞋套", leafNames: ["防滑鞋套"], mode: "replace", sources: ["codex-domain"],
    reason: "防滑结构与适用地面是两个维度。删除防滑类型与场景的重复描述，不把冰爪套等同所有鞋套。",
    properties: [brand,model,T("size", "适配鞋码", "注明鞋码体系及兼容范围。",true),T("sole_material", "底部材质", "接触地面的防滑材料。"),T("anti_slip_structure", "防滑结构", "按实际商品说明防滑纹路、颗粒、钉爪等结构；保持开放。"),T("surface", "适用地面", "厂家明确声明适用的地面条件，可多项填写。"),T("upper_material", "鞋套主体材质", "包覆与固定部分材料。"),T("fastening", "固定方式", "实际固定结构。"),T("reuse", "使用形式", "一次性或可重复使用。"),T("pack", "包装规格", "每包装对数及附件。")],
  },
  {
    id: "grease-gun", title: "黄油枪", leafNames: ["黄油枪"], mode: "replace", sources: ["codex-domain"],
    reason: "采购核心是驱动、供脂形式、容量、压力及接头。删除把单活塞、双活塞、折叠式混在一起的候选枚举。",
    properties: [brand,model,T("drive", "驱动方式", "手动、气动、电动等实际驱动方式。",true),T("loading", "装脂方式", "支持的脂筒规格或散装加注方式。"),N("capacity", "装脂容量", "mL", "储脂筒有效容积；厂家只给质量时在装脂方式中注明其质量规格。"),N("pressure", "最大输出压力", "MPa", "额定工况下最大供脂压力，不等于气源压力。"),T("delivery", "供脂量", "明确每行程或单位时间的供脂量及相应单位。"),T("fitting", "出油接头", "油嘴连接规格及接头形式。"),T("tube", "输脂管配置", "硬管/软管及长度，按实际附件填写。"),when(N("air_pressure", "工作气压", "MPa", "规定的供气压力。"),"气动型号"),when(T("battery", "电池配置", "额定电压、容量及交付数量。"),"电池驱动型号")],
  },
  {
    id: "insulation-pipe", title: "保温管", leafNames: ["保温管"], mode: "replace", sources: ["codex-domain"],
    reason: "名称可能指保温套管，也可能指带输送内管的复合管。先表达交付形态，承压等字段只用于含输送内管的产品。",
    scopeNote: "类目名称存在交付对象歧义；通过产品形态和条件属性容纳，不修改类目。",
    properties: [brand,model,T("form", "产品形态", "明确为管道保温套管、保温软管或带输送内管的预制保温管等。",true),T("insulation_material", "保温层材质", "保温材料名称。",true),N("inner_diameter", "内径", "mm", "注明是保温套管内径还是输送内管内径。",true),N("insulation_thickness", "保温层厚度", "mm", "保温层径向厚度。",true),N("length", "交付长度", "m", "每根或每卷的有效长度。"),T("temperature", "使用温度范围", "厂家给出的持续使用温度区间。",false,"℃"),T("conductivity", "导热系数", "记录导热系数及测定平均温度，不能脱离温度直接比较。",false,"W/(m·K)"),T("fire", "燃烧性能等级", "仅记录检测报告或产品声明中的分级体系及等级。"),when(T("inner_pipe", "输送内管规格", "内管材质、尺寸和连接形式。"),"交付物包含输送内管时"),when(T("pressure", "允许工作压力", "厂家声明值及适用温度条件。",false,"MPa"),"交付物包含承压输送内管时")],
  },
  {
    id: "valve", title: "手动流体阀门", paths: [["泵、阀及管路","阀门","手动阀门"]], leafNames: ["手动球阀","手动截止阀","手动蝶阀","手动隔膜阀","铸钢蝶阀","铸铁蝶阀","手动平衡阀","铸钢截止阀","铸钢球阀","手动排污阀","手动针型阀","手动柱塞阀","手动旋塞阀","铸铁球阀","PE球阀","手动闸阀","铜截止阀","手动调节阀","铸铁柱塞阀","手动节流阀","铸铁蜗轮蝶阀","手动角座阀","PPR闸阀"], mode: "replace", sources: ["codex-domain"],
    reason: "DN 为公称尺寸标识，不当成精确内径；PN/Class 与实际允许工作压力分开。排除阀套、软管及风道闸门。",
    properties: [brand,model,T("nominal_size", "公称尺寸", "注明 DN/NPS 体系及标称值，不等同实际内径。",true),T("pressure_class", "压力等级", "完整 PN 或 Class 标识及适用标准。",true),T("body", "阀体材质", "阀体材料牌号。",true),T("connection", "连接形式", "法兰、螺纹、焊接等形式及连接标准。",true),T("seal", "密封材料", "主要阀座或密封件材质。"),T("medium", "适用介质", "厂家声明的兼容介质，避免未经验证的通用耐腐蚀描述。"),temperature,T("actuation", "操作机构", "手柄、手轮、蜗轮等实际手动操作形式。"),T("flow", "流道与结构", "通道数、通径形式等；按阀型填写。"),standard],
  },
  {
    id: "centrifugal-pump", title: "离心泵整机", paths: [["泵、阀及管路","泵","离心泵"]], leafNames: ["单级离心泵","自吸泵","变频增压泵","泳池泵","立式管道泵","多级离心泵","液下泵","机床泵","双吸离心泵","化工泵","汽柴油移动泵","干式污水泵"], mode: "replace", sources: ["codex-domain"],
    reason: "流量、扬程必须对应同一额定工况，不能将各自最大值拼成不存在的工作点。配件、离心机、加湿机独立处理。",
    properties: [brand,model,N("rated_flow", "额定流量", "m³/h", "与额定扬程对应的工况流量。",true),N("rated_head", "额定扬程", "m", "与额定流量对应的总扬程。",true),T("drive", "驱动配置", "电机或发动机类型及功率；裸泵说明不含驱动。"),T("wet_material", "过流部件材质", "泵体、叶轮及密封接液部件材质。"),T("medium", "输送介质", "介质及允许温度、颗粒等约束按实际说明。"),T("inlet", "进口连接规格", "连接制式、尺寸和形式。"),T("outlet", "出口连接规格", "连接制式、尺寸和形式。"),T("seal", "轴封形式", "实际轴封结构及材质。"),N("speed", "额定转速", "r/min", "额定工况转速。"),T("installation", "安装形式", "立式/卧式等安装结构。")],
  },
  {
    id: "cylinder", title: "直线气缸", paths: [["气动液压","气动执行元件","标准型气缸"]], mode: "replace", sources: ["festo-cylinder"],
    reason: "缸径、行程和工作压力独立记录；安装标准相同仍要核对接口、缓冲与磁性开关条件。",
    properties: [brand,model,N("bore", "缸径", "mm", "活塞公称直径。",true),N("stroke", "行程", "mm", "活塞杆有效工作行程。",true),S("action", "作用方式", ["单作用","双作用"], "直线气缸由气压驱动一个方向或两个方向的运动；未知留空。"),T("pressure", "工作压力范围", "厂家声明的最低～最高工作气压。",false,"MPa"),T("port", "气口规格", "螺纹制式及尺寸。"),T("mounting", "安装形式", "安装结构和附件配置。"),T("cushion", "缓冲方式", "缓冲结构及可调性。"),B("magnet", "是否带磁环", "活塞是否有磁环，不等于已经随货带磁性开关。"),T("rod", "活塞杆端连接", "连接螺纹或接头规格。"),standard],
  },
  {
    id: "pipette-tip", title: "移液吸头", leafNames: ["吸头"], mode: "replace", sources: ["eppendorf-tip"],
    reason: "量程、适配、过滤、灭菌与洁净声明分开；不能由带滤芯推断无菌，也不能由无菌推断无核酸酶。",
    properties: [brand,model,T("volume_range", "适用移液体积", "可用体积范围或额定最大体积。",true,"μL"),fitModels,T("material", "材质", "吸头主体材质及低吸附处理。"),B("filter", "是否带滤芯", "交付吸头是否包含过滤芯。"),B("sterile", "是否无菌", "依据厂家包装声明，未知留空。"),T("purity", "洁净声明", "DNA/RNA、核酸酶、内毒素等逐项记录厂家声明。"),B("low_retention", "是否低吸附", "厂家明确声明的低吸附/低残留处理。"),T("length", "吸头长度", "常规/加长及实际长度。",false,"mm"),T("pack", "包装规格", "袋装、盒装或补充装；每盒/袋数量与外包装数量。")],
  },
  {
    id: "hemostat", title: "止血钳", leafNames: ["止血钳"], mode: "replace", sources: ["codex-domain"],
    reason: "本类位于实验室用品，先记录声明用途；不能仅凭商品名称推断已注册的外科用途。钳端弯直与有无齿分开。",
    properties: [brand,model,T("declared_use", "声明用途", "按厂家说明填写实验室夹持或其他声明用途。",true),N("length", "全长", "mm", "器械全长。",true),T("tip_shape", "钳端形态", "直型或弯型及弯曲描述，不与有齿/无齿混写。"),T("jaw", "钳口结构", "有齿/无齿、齿纹与夹持端结构。"),material,T("lock", "锁止结构", "是否有锁扣及锁止形式。"),T("reuse", "使用与处理方式", "厂家声明的一次性/重复使用及清洁灭菌兼容条件。"),when(T("device_registration", "医疗器械注册或备案信息", "按产品实际注册/备案资料填写。"),"产品以医疗器械用途供应时")],
  },
  {
    id: "light-bulb", title: "通用照明灯泡", paths: [["照明","照明光源","LED光源"]], leafNames: ["灯泡","蜡烛泡","LED灯泡","灯丝灯","灯杯"], mode: "replace", sources: ["philips-light"],
    reason: "以灯头、电气与光学参数描述兼容性；色温 K、光通量 lm、功率 W 与无量纲显色指数区分。",
    properties: [brand,model,T("cap", "灯头规格", "标准灯头代号及尺寸。",true),power,voltage,N("flux", "光通量", "lm", "额定工况光通量。"),T("cct", "色温", "固定色温或可调范围；彩色光源另注明光色。",false,"K"),N("cri", "显色指数", null, "厂家标称 Ra；无单位。"),B("dimmable", "是否可调光", "需同时注明兼容的调光方式。"),T("dimming", "调光方式", "仅可调光产品填写支持的控制方式。"),N("beam", "光束角", "°", "定向光源适用。"),dimensions],
  },
  {
    id: "fresh-light", title: "生鲜灯", leafNames: ["生鲜灯"], mode: "replace", sources: ["philips-light"],
    reason: "保留安装、电气及光学参数；商品展示光谱用开放描述，不把“猪肉红光”等品牌命名定成通用枚举。",
    properties: [brand,model,power,voltage,T("installation", "安装方式", "轨道、吊装、嵌入等实际结构。"),T("spectrum", "光谱或光色方案", "厂商光谱方案及适用陈列对象，可记录检测指标。"),T("cct", "色温", "厂家声明的色温或范围。",false,"K"),N("cri", "显色指数", null, "厂家标称 Ra，无单位。"),N("flux", "光通量", "lm", "额定工况光通量。"),N("beam", "光束角", "°", "光束分布角度。"),T("dimming", "调光控制", "支持的调光与控制方式。"),dimensions,T("ip", "防护等级", "厂家明确声明的 IP 等级。")],
  },
  {
    id: "access-camera", title: "门禁摄像头", leafNames: ["门禁摄像头"], mode: "replace", sources: ["hikvision-camera"],
    reason: "摄像头与门禁主机能力分开。变焦焦距与温度范围允许区间，不能强制为单个数字。",
    properties: [brand,model,T("resolution", "视频分辨率", "实际输出的横×纵像素。",true,"px"),N("fps", "最大帧率", "fps", "注明对应的视频分辨率。"),T("lens", "镜头焦距", "定焦值或变焦范围。",false,"mm"),T("sensor", "图像传感器", "类型、尺寸及厂家型号（如已公布）。"),T("interface", "视频与通信接口", "物理接口及支持协议，分别说明。"),T("vision", "低照度与补光", "最低照度、补光类型及厂家声明距离。"),voltage,B("poe", "支持PoE", "是否支持 PoE，并按资料注明协议。"),T("recognition", "本机识别能力", "仅记录摄像头自身实现的识别能力，不继承后台系统功能。"),temperature,T("ip", "防护等级", "厂家声明的 IP 等级。"),T("mounting", "安装形式", "安装位置、支架与固定方式。")],
  },
  {
    id: "fridge", title: "冰箱", leafNames: ["冰箱"], mode: "replace", sources: ["codex-domain"],
    reason: "净容积、分区、制冷与安装尺寸用于实际选型；平台区间标签不与真实尺寸同时输出。",
    properties: [brand,model,N("total_volume", "总有效容积", "L", "按产品标示的有效容积口径。",true),T("compartments", "间室容积", "冷藏、冷冻、变温等间室分别填写，单位 L。"),T("door", "箱门结构", "实际门数与布局。"),T("cooling", "制冷方式", "直冷、风冷或混冷等实际方式。"),T("defrost", "除霜方式", "自动或手动等实际形式。"),T("temperature_control", "温控方式", "控制方式与可设定温区。"),T("efficiency", "能效标识", "标识上的等级及执行标准，不按未知规格推断。"),N("energy", "标称耗电量", "kWh/24h", "注明测试标准/工况，避免与实测使用耗电混同。"),N("noise", "声功率级", "dB(A)", "仅当厂家明确声功率口径时填写；声压级应另注明。"),dimensions,T("clearance", "安装预留要求", "散热与开门所需的厂家建议间隙。"),color],
  },
  {
    id: "service-repair", title: "家电维修服务", leafNames: ["家电维修"], mode: "replace", sources: ["codex-domain"],
    reason: "服务属性描述交付范围和条件，不使用商品材质、颜色、额定功率等参数。",
    properties: [T("provider", "服务提供方", "实际服务主体名称。"),T("appliance", "维修对象", "支持维修的电器类型、品牌与型号范围。",true),T("content", "服务内容", "诊断、维修、调试等具体交付项目及不含项目。",true),T("region", "服务区域", "可提供服务的地区与覆盖范围。",true),T("mode", "服务方式", "上门、送修或远程支持等实际形式。"),T("response", "响应与完成时限", "明确预约、响应及完成的约定条件。"),T("parts", "配件与材料约定", "是否包含配件、材料的计费及质保范围。"),T("acceptance", "验收与质保约定", "验收内容及维修服务质保期。")],
  },
  {
    id: "cook-pot", title: "多功能电锅", leafNames: ["多功能锅"], mode: "replace", sources: ["codex-domain"],
    reason: "基础烹饪参数与安全使用条件构成主体；不写国补备案型号、上市时间等平台属性。PTFE 与特氟龙不能当互斥材料。",
    properties: [brand,model,N("capacity", "额定容量", "L", "标称锅体容量；多锅胆分别说明。",true),power,voltage,T("heating", "加热方式", "实际加热结构。"),T("functions", "烹饪功能", "实际支持的功能，可多项填写。"),T("pot_material", "内锅基材", "与表面涂层分别记录。"),T("coating", "接触面涂层", "涂层材料或厂家声明；商标名可作为补充。"),T("control", "操控方式", "实际操作与温控方式。"),T("temp", "可控温度范围", "厂家声明的可设温度区间。",false,"℃"),B("removable", "内锅是否可拆卸", "交付结构是否支持拆卸清洁。"),T("accessories", "随附配件", "锅胆、蒸架等交付清单。")],
  },
  {
    id: "oil-press", title: "榨油机", leafNames: ["榨油机"], mode: "replace", sources: ["codex-domain"],
    reason: "原料处理能力与出油量不同，不在缺少原料和工况时给出固定出油率。",
    properties: [brand,model,T("principle", "压榨原理", "实际压榨机构和工艺。"),T("materials", "适用原料", "厂商明确适用的油料及预处理要求。",true),T("throughput", "原料处理能力", "标明 kg/h 及对应原料、含水率等工况。"),power,voltage,T("temperature", "压榨温控", "可控温度范围及冷/热榨条件。"),T("wet_material", "接触原料部件材质", "料斗、压榨及接油部件的材料。"),T("control", "操作与控制方式", "上料、控制和停机方式。"),dimensions,T("cleaning", "拆洗与清洁方式", "可拆部件和清洁要求。")],
  },
  {
    id: "baking-tools", title: "烘焙用具", leafNames: ["烘焙用具"], mode: "replace", sources: ["codex-domain"],
    reason: "容纳模具、垫、量具等多种对象，先填器具类型，再按条件收集尺寸或容量；不强填全部形态的参数。",
    properties: [brand,model,T("tool_type", "器具类型", "说明实际交付的烘焙器具类型或套装清单。",true),T("food_material", "主要材质", "食品接触部位与支撑部件分别注明。"),T("coating", "接触面涂层", "无涂层按实际记录。"),dimensions,when(N("capacity", "容量", "mL", "额定或有效容量口径按产品说明。"),"模具、容器或量杯类"),when(T("temperature", "适用温度范围", "按产品声明填写。",false,"℃"),"需加热、冷冻或温度有使用限制的器具"),T("equipment", "适用设备", "声明适用于烤箱、微波炉等设备，未声明不推断。"),T("pack", "套装与包装规格", "每件类型、规格与数量。")],
  },
  {
    id: "financial-kit", title: "财务成套器材", leafNames: ["财务成套器材"], mode: "replace", sources: ["codex-domain"],
    reason: "套装核心是组成清单和兼容对象，不能用大量互斥的“是否包含某设备”替代完整交付清单。",
    properties: [brand,model,T("components", "套装组成", "逐项填写器材名称、型号/规格与数量。",true),T("application", "适用业务", "明确票据、现金或档案等使用对象。"),T("compatibility", "配套兼容要求", "耗材、系统或接口有配套要求时填写。"),T("delivery", "交付与安装范围", "成套设备的安装、连接及调试交付范围。")],
  },
  {
    id: "xenon-chamber", title: "氙灯耐候试验箱", leafNames: ["氙灯耐气候试验箱"], mode: "replace", sources: ["codex-domain"],
    reason: "辐照度必须注明控制波长或波段。黑板温度、黑标温度、箱内空气温度是不同量，不能混成一个温度字段。",
    properties: [brand,model,T("chamber", "有效试验空间", "有效长×宽×高及样品架容量。",false,"mm"),T("light", "氙灯及滤光系统", "灯型、冷却方式及滤光片组合。"),T("irradiance", "辐照度控制范围", "数值范围、单位和控制波长/波段一起填写，如 W/(m²·nm) 与 W/m² 不混用。",true),T("black_temperature", "黑板或黑标温度范围", "注明使用 BPT 或 BST 传感器及量程。",false,"℃"),T("air_temperature", "箱内空气温度范围", "与黑板/黑标温度分别记录。",false,"℃"),T("humidity", "相对湿度范围", "注明温度条件。",false,"%RH"),T("cycles", "喷淋与循环功能", "喷淋、明暗周期等实际支持模式。"),T("sample", "样品承载配置", "样品尺寸、数量及夹具形式。"),standard,power,voltage],
  },
  {
    id: "copy-paper", title: "平张复印纸", leafNames: ["复印纸","彩色复印纸"], mode: "replace", sources: ["codex-domain"],
    reason: "纸张幅面与定量是不同选型维度，g/m² 不是单张重量。包装张数不写成规格枚举。",
    properties: [brand,T("series", "系列或型号", "厂家系列名称或货号。"),T("format", "幅面规格", "标准幅面或实际宽×长。",true),N("grammage", "定量", "g/m²", "单位面积质量，即纸张克重。",true),color,N("sheets", "每包装张数", "张", "最小销售包装内纸张数量。"),N("packs", "每箱包装数", "包", "箱装产品的包数。"),T("printing", "适用打印方式", "厂家声明的激光、喷墨等兼容性。"),T("whiteness", "白度或亮度", "注明采用的指标体系及数值；不同测试体系不直接比较。")],
  },
  {
    id: "printer-consumables", title: "打印硒鼓与墨粉", paths: [["办公用品","打印耗材","硒鼓/墨粉"]], mode: "replace", sources: ["codex-domain"],
    reason: "适配型号、耗材形态、颜色与标称印量决定选购；印量要带测试覆盖率或标准。",
    properties: [brand,model,T("type", "耗材类型", "硒鼓、墨粉瓶或组件等交付对象。",true),fitModels,T("color", "打印颜色", "按打印色通道记录，可多项用于套装。",true),T("yield", "标称打印量", "页数及覆盖率/测试标准；不承诺实际业务打印页数。"),T("chip", "芯片与识别配置", "是否含芯片及支持的版本要求。"),T("pack", "包装组成", "每种耗材规格和数量。")],
  },
  {
    id: "caster", title: "脚轮整件", paths: [["搬运存储","脚轮","工业脚轮"]], leafNames: ["孔顶型脚轮","防静电轮","万向轮","丝杆型脚轮","平顶型脚轮","静音轮","水平调节轮","耐高温轮","插杆型脚轮","减震轮"], mode: "replace", sources: ["codex-domain"],
    reason: "脚轮承载为单轮工况值；支架、轮片、运输服务不继承整轮参数。",
    properties: [brand,model,N("diameter", "轮径", "mm", "轮体外径。",true),N("width", "轮宽", "mm", "轮面有效宽度。"),N("load", "单轮额定载荷", "kg", "注明动态或静态额定载荷及工况；不能直接乘轮数当整车承重。",true),T("tread", "轮面材质", "接地轮面材料。"),T("mounting", "安装接口", "底板孔距、丝杆或插杆规格。",true),N("height", "安装总高", "mm", "从安装面至地面的总高。"),T("swivel", "转向结构", "定向、万向等实际结构。"),T("brake", "制动形式", "刹车作用对象和操作方式。"),T("bearing", "轮轴轴承形式", "轮体使用的轴承/轴套结构。")],
  },
  {
    id: "sling", title: "纤维吊装带", paths: [["搬运存储","吊索具","吊带"]], excludeNames: ["吊带配件"], mode: "augment", sources: ["codex-domain"],
    reason: "工作载荷取决于吊装方式与夹角，不能只给一项无工况的吨位。",
    properties: [T("wll", "额定工作载荷", "记录制造商额定 WLL 及直吊/结套/篮吊条件。",true,"t"),N("effective_length", "有效工作长度", "m", "按吊带结构定义的有效长度。",true),T("fiber", "带体材料", "承力纤维材料。"),T("construction", "结构形式", "扁平/圆形及环状/吊环等实际形式。"),T("label", "标识与追溯", "额定载荷标牌、制造信息或可追溯编号的填写要求。"),standard],removeNames:["材质","长度","额定载荷","吊带类型","类型"],
  },
  {
    id: "lubricant", title: "齿轮油与液压油", paths: [["实验室及化学用品","工业润滑油","齿轮油"],["实验室及化学用品","工业润滑油","液压油"]], mode: "augment", sources: ["codex-domain"],
    reason: "黏度等级与运动黏度分开；测定温度是黏度、密度等参数的必要条件。食品接触声明不能由商品名称自动补证。",
    properties: [T("viscosity_grade", "黏度等级", "注明 ISO VG 或其他明确体系及等级。",true),T("base_oil", "基础油类型", "按技术资料记录基础油体系，保持开放。"),T("kinematic_viscosity", "运动黏度", "给出数值和测定温度，分别记录 40℃/100℃ 等工况。",false,"mm²/s"),T("approval", "制造商认可或规范", "仅记录产品资料明确声明的规范及认可。"),T("pack", "净含量与包装", "每销售包装净含量及 kg/L 口径。")],removeNames: ["粘度等级","基础油类型","包装规格"],
  },
  {
    id: "power-cable", title: "电力电缆", paths: [["电气类","电线电缆","电力电缆"]], mode: "augment", sources: ["codex-domain"],
    reason: "导体截面积、芯数组合和额定电压是基本选型信息，截面积单位不能与直径混用。",
    properties: [T("cable_designation", "电缆型号", "完整型号和结构代号。",true),T("voltage_u", "额定电压U0/U", "保留对地/相间电压口径。",true,"kV"),T("core_section", "芯数及截面积", "主芯、中性线、保护线分别记录截面积和数量。",true,"mm²", "3×35+1×16"),T("conductor", "导体材料", "导体材质与等级。"),T("insulation", "绝缘材料", "主绝缘层材料。"),T("sheath", "护套材料", "外护套材料。"),T("armour", "铠装结构", "无铠装或具体铠装形式。"),T("fire_behavior", "阻燃耐火特性", "明确分级体系和已声明的等级，不仅写是/否。"),standard],removeNames: ["型号","电缆规格","导体材质","绝缘材质","额定电压","截面积","标称截面","芯数","护套材质","铠装类型","是否铠装","阻燃等级","防火等级"],
  },
  {
    id: "circuit-breaker", title: "低压断路器整件", paths: [["电气类","中低压配电","断路器"]], leafNames: ["微型漏电保护断路器","塑壳漏电保护断路器","电机保护断路器","塑壳断路器","微型断路器","框架断路器"], mode: "augment", sources: ["codex-domain"],
    reason: "极数、电流、电压、脱扣与分断能力分开；漏电动作参数只用于含剩余电流保护的产品。",
    properties: [N("rated_current", "额定电流", "A", "明确 In，与壳架电流分开。",true),T("poles", "极数与保护极配置", "按产品代号注明 N 极和保护极。",true),T("rated_voltage", "额定工作电压", "Ue 的交流/直流类型及电压值。",false,"V"),T("breaking", "分断能力", "记录 Icn/Icu/Ics 的类型、数值和对应电压及标准。",false,"kA"),T("trip", "脱扣特性", "脱扣器类型、曲线或电子脱扣整定范围。"),when(T("residual", "剩余电流动作参数", "动作电流、类型与延时。"),"含剩余电流保护的型号"),standard],removeNames:["额定电压","额定短路分断能力","脱扣曲线","脱扣器类型","漏电动作电流","漏电动作时间","漏电保护类型"],
  },
  {
    id: "switching-supply", title: "工业开关电源", leafNames: ["开关电源"], mode: "replace", sources: ["codex-domain"],
    reason: "输出电压与允许电流形成实际供电能力，多路输出按通道说明，不与输入功率混淆。",
    properties: [brand,model,T("input", "输入电源", "AC/DC、范围及频率。",true),T("output", "输出配置", "每路输出电压、额定电流、隔离及可调范围。",true),N("output_power", "额定输出功率", "W", "总额定输出功率，受各路负载组合限制时注明。"),T("mounting", "安装形式", "导轨、底板等实际安装形式。"),T("protection", "保护功能", "厂家声明的短路、过载、过压等保护。"),temperature,dimensions,T("cooling", "散热方式", "自然冷却或风冷及安装降额条件。")],
  },
  {
    id: "abrasive-paper", title: "砂纸与砂带", paths: [["金属加工","磨具","砂纸"],["金属加工","磨具","砂带"]], excludeNames: ["砂纸托盘"], mode: "augment", sources: ["codex-domain"],
    reason: "粒度标号需注明体系，P、JIS 和微米值不能直接混成枚举。托盘是附件，不是磨料。",
    properties: [T("grit", "粒度标号", "记录 P 号、JIS 等适用粒度体系及标号。",true),T("abrasive", "磨料种类", "按产品资料记录磨粒材料。"),T("backing", "基材", "纸、布、薄膜等载体与等级。"),T("size", "成品尺寸", "片材宽×长；砂带宽×周长，明确形式。",true,"mm"),T("workpiece", "适用工件材料", "制造商推荐加工材料。"),S("wet_dry", "干湿磨兼容性", ["仅干磨","仅湿磨","干湿两用"], "依据产品说明选择允许的使用方式；未知留空，不从磨料颜色推断。")],removeNames: ["粒度","砂粒度","磨料材质","磨料类型","背基类型","宽度","长度","是否耐水"],
  },
  {
    id: "office-desk", title: "桌体", paths: [["家具","商业家具","桌类"]], excludeNames: ["桌类配件","连体书桌柜"], mode: "augment", sources: ["codex-domain"],
    reason: "家具主体尺寸与安装使用功能优先；升降范围只适用于可升降结构。",
    properties: [T("top_material", "台面材质", "基材、饰面与封边按层次填写。"),T("frame_material", "支撑结构材质", "桌架或柜体结构材料。"),dimensions,T("load", "额定承载", "厂家给出的载荷及分布、动态/静态条件。",false,"kg"),when(T("adjust_height", "高度调节范围", "最低～最高台面高度及操作方式。",false,"mm"),"可调高度的桌体"),T("assembly", "安装与交付形式", "整装/拆装及随附配件。")],removeNames:["桌面材质","承重","最大承重","升降高度范围","产品尺寸"],
  },
  {
    id: "office-chair", title: "椅子", paths: [["家具","商业家具","椅类"]], excludeNames: ["椅类配件","电竞仓"], mode: "augment", sources: ["codex-domain"],
    reason: "座面、靠背和承载为椅子核心；人体调节能力记录实际可调部位，不按“人体工学”宣传补齐。",
    properties: [T("seat_material", "座面与靠背材质", "表面、填充及承力框架分别说明。"),T("seat_size", "座面尺寸", "有效宽度与深度。",false,"mm"),T("seat_height", "座高", "固定高度或可调范围。",false,"mm"),T("adjustment", "调节功能", "按实际填写靠背、扶手、腰托等可调部位。"),T("load", "额定承载", "厂家声明的适用载荷与条件。",false,"kg"),dimensions],removeNames:["座宽","座深","最大承重","承重","坐垫材质"],
  },
  {
    id: "floor-scrubber", title: "手推式洗地机", leafNames: ["手推式洗地机"], mode: "replace", sources: ["codex-domain"],
    reason: "清洗宽度、污水回收和续航用于面积及工况选型；理论效率不当实际承诺。",
    properties: [brand,model,N("width", "清洗宽度", "mm", "有效刷洗作业宽度。",true),N("efficiency", "标称作业效率", "m²/h", "注明理论效率或测试条件。"),N("clean_tank", "清水箱容积", "L", "有效容积。"),N("dirty_tank", "污水箱容积", "L", "有效容积。"),T("power", "供电配置", "电源类型；电池型号需注明电压、容量和交付数量。"),T("brush", "刷盘配置", "刷盘形式、数量及清洗压力。"),T("runtime", "续航时间", "注明负载、地面与电池配置。",false,"h"),T("squeegee", "吸水扒规格", "吸水宽度、材质和可替换胶条规格。"),dimensions],
  },
  {
    id: "pet-food", title: "猫狗食品", paths: [["宠物相关","宠物生活","猫狗主粮"],["宠物相关","宠物生活","猫食品"],["宠物相关","宠物生活","狗食品"]], excludeNames:["鱼粮/小宠"], mode: "augment", sources: ["codex-domain"],
    reason: "按包装声明区分适用物种、生命阶段和全价/补充用途。处方名称不直接推断疾病治疗效果。",
    properties: [T("pet_species", "适用动物", "包装明确标示的动物种类。",true),T("life_stage", "适用生命阶段", "包装标示的年龄阶段或全阶段。"),T("food_role", "食品用途分类", "按包装声明记录全价、补充、零食或特殊用途。"),T("ingredients", "配料表", "依据产品标签记录配料，不能从口味名称推断完整成分。"),T("analysis", "成分分析保证值", "指标、数值、上下限及干物质/原样基础需注明。"),T("net_content", "净含量", "数值及单位，含多包装时列明数量。",true),T("storage", "储存条件", "按包装记录未开封与开封后的储存条件。")],removeNames:["适用宠物","适用阶段","粗蛋白质","粗蛋白","粗脂肪","粗纤维","粗灰分","水分","钙","总磷","赖氨酸","水溶性氯化物（以Cl-计）","牛磺酸","功效"],
  },
  {
    id: "racket", title: "羽毛球拍", leafNames: ["羽毛球拍"], mode: "replace", sources: ["codex-domain"],
    reason: "拍重等级、握把规格和建议拉线磅数影响适配，按厂家声明记录。",
    properties: [brand,model,T("frame", "拍框材质", "主要材料和复合结构。"),T("shaft", "中杆材质与硬度", "材料及厂家标称软硬等级；不同品牌等级不直接比较。"),T("weight", "拍重规格", "注明重量或 U 等级及是否含线手胶。",true),T("grip", "握把规格", "厂家 G 号或实际周长。"),T("balance", "平衡点", "从拍柄底端量起，注明测量配置。",false,"mm"),T("tension", "建议拉线范围", "厂家规定的适用拉线磅数范围。",false,"lb"),B("strung", "是否已穿线", "实际交付配置。"),color],
  },
  {
    id: "basketball", title: "篮球", leafNames: ["篮球"], mode: "replace", sources: ["codex-domain"],
    reason: "球号、材质和使用场地为基本选型属性；不自动声明赛事认证。",
    properties: [brand,model,T("size", "球号", "按实际球号或标准尺寸标示。",true),T("cover", "表皮材质", "球体表皮材料。"),T("court", "适用场地", "厂家声明适合的室内外场地。"),N("weight", "标称重量", "g", "产品标称重量，允许范围可在说明中注明。"),T("pressure", "建议充气压力", "厂家建议的范围及单位，不填统一猜测值。"),T("standard", "规格或认证声明", "实际标示的规格标准或认证。")],
  },
  {
    id: "food-oil", title: "食用油", leafNames: ["食用油"], mode: "replace", sources: ["codex-domain"],
    reason: "食品属性从标签记录品种、配料、净含量及贮存要求，不根据名称推断营养或健康效果。",
    properties: [brand,T("name", "产品名称", "包装标示的完整产品名称。",true),T("oil_type", "油品种类", "标签所示单一油种或调和油。",true),T("ingredients", "配料表", "按标签顺序记录。"),T("process", "加工工艺", "标签明确标示的加工方式。"),T("net_content", "净含量与包装", "每包装净含量及单位，套装另记数量。",true),T("shelf_life", "保质期", "标签标明的期限及单位。"),T("storage", "储存条件", "标签规定的储存条件。"),standard],
  },
  {
    id: "ambiguous-box", title: "养护箱", leafNames: ["养护箱"], mode: "replace", sources: ["codex-domain"],
    reason: "原名称不足以判定为植物养护还是其他养护设备，保留用途字段，不凭园林父类捏造恒温恒湿功能。",
    scopeNote: "缺少明确产品样本；当前模板先描述交付对象和基本规格。",
    properties: [brand,model,T("object", "养护对象与用途", "厂家说明中实际养护的对象与用途。",true),T("structure", "结构与配置", "箱体、分区及实际附带的功能组件。"),dimensions,material,when(T("conditions", "可控养护条件", "仅按设备说明记录温度、湿度等实际可控条件与范围。"),"包含环境控制功能时"),T("delivery", "交付内容", "箱体及附带设备、耗材的清单。")],
  },
];

export const packs: KnowledgePack[] = basePacks.map(applyRequirements);
