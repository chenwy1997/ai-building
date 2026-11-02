import type { KnowledgePack, KnowledgeProperty } from "./types.ts";

// Explicit catalogue-entry proposals, not manufacturer mandates or legal requirements.
// Keys are scoped to a reviewed pack: no keyword or same-name global promotion.
export const requiredFields: Record<string, { keys: string[]; reason: string }> = {
  phone: { keys: ["model", "os", "screen_inches", "cellular", "color"], reason: "标识销售版本及基本配置，支持同款规格区分。" },
  computer: { keys: ["gpu", "os"], reason: "图形方案和预装系统决定整机交付配置；无独显、未预装按实际填写。" },
  "threaded-nut": { keys: ["material", "surface_treatment"], reason: "相同螺纹仍有材料及表面工艺差异，缺少时无法准确匹配采购规格。" },
  "hex-nut": { keys: ["material", "surface_treatment", "thread_direction"], reason: "材料、表面工艺和旋向影响螺母匹配；无处理应明确填写。" },
  "hex-bolt": { keys: ["material", "surface_treatment", "thread_length"], reason: "材料、表面工艺及全/半螺纹共同区分交付规格。" },
  "flat-washer": { keys: ["material", "surface_treatment"], reason: "尺寸相同的垫圈仍需区分材质和表面工艺。" },
  "rolling-bearing": { keys: ["precision", "seal"], reason: "精度与密封结构影响互换；按完整代号或厂家资料确认。" },
  "timing-belt": { keys: ["body_material", "construction"], reason: "带体材料和开口/闭合等结构决定适用工况及交付对象。" },
  earplug: { keys: ["material", "size", "corded", "reuse", "pack"], reason: "材料、尺寸、带线形式和销售包装决定耳塞交付规格。" },
  "warm-earmuff": { keys: ["outer_material", "lining", "size", "wearing"], reason: "面料、内衬、尺寸和佩戴方式构成保暖耳罩基本规格。" },
  "anti-slip-cover": { keys: ["sole_material", "anti_slip_structure", "surface", "pack"], reason: "防滑结构、适用地面和包装必须明确，才能按用途采购。" },
  "grease-gun": { keys: ["loading", "fitting"], reason: "装脂与出油接头须与耗材和受脂设备匹配。" },
  "insulation-pipe": { keys: ["length"], reason: "每根/卷交付长度决定数量换算与采购规格。" },
  valve: { keys: ["seal", "medium"], reason: "介质与密封材料是判断阀门适配的必要信息。" },
  "centrifugal-pump": { keys: ["drive", "wet_material", "medium", "inlet", "outlet"], reason: "驱动交付范围、接液材料、介质及接口决定泵的使用和安装适配。" },
  cylinder: { keys: ["action", "pressure", "port", "mounting"], reason: "动作、气源范围、气口和安装形式决定气缸系统适配。" },
  "pipette-tip": { keys: ["compatible_models", "material", "filter", "sterile", "pack"], reason: "量程以外还需确认移液器适配、过滤/无菌状态和包装；未知状态待补资料。" },
  hemostat: { keys: ["tip_shape", "jaw", "material"], reason: "钳端、钳口和材质构成夹持器械的基本规格。" },
  "light-bulb": { keys: ["rated_power", "supply_voltage", "flux", "dimmable"], reason: "电气兼容、亮度和调光能力是照明光源基本选型项。" },
  "fresh-light": { keys: ["rated_power", "supply_voltage", "installation", "spectrum"], reason: "供电、功率、安装和光色方案决定生鲜灯能否用于目标陈列。" },
  "access-camera": { keys: ["model", "interface", "mounting"], reason: "完整型号、视频通信接口及安装方式决定门禁系统兼容。" },
  fridge: { keys: ["model", "door", "cooling", "dimensions"], reason: "容积外还须明确型号、箱门、制冷形式和安装占用尺寸。" },
  "service-repair": { keys: ["provider", "mode", "parts", "acceptance"], reason: "服务主体、履约方式、配件范围和验收约定共同定义交付。" },
  "cook-pot": { keys: ["rated_power", "supply_voltage", "functions", "pot_material", "coating"], reason: "电气配置、烹饪能力和接触部件材料构成电锅基本交付规格。" },
  "oil-press": { keys: ["principle", "throughput", "rated_power", "supply_voltage"], reason: "压榨方式、处理能力和电源要求决定原料与使用场景适配。" },
  "baking-tools": { keys: ["food_material", "pack"], reason: "器具材质及套装清单明确实际交付内容。" },
  "financial-kit": { keys: ["application", "delivery"], reason: "成套器材需要明确业务用途和交付安装范围。" },
  "xenon-chamber": { keys: ["model", "chamber", "light", "rated_power", "supply_voltage"], reason: "试验空间、光源滤光配置和供电条件限定设备基本能力。" },
  "copy-paper": { keys: ["color", "sheets"], reason: "纸色与每包装张数影响打印需求及采购数量换算。" },
  "printer-consumables": { keys: ["compatible_models", "pack"], reason: "耗材必须明确适配设备和包装组成，不能仅凭颜色或外观匹配。" },
  caster: { keys: ["tread", "height", "swivel", "brake"], reason: "轮面、安装高度、转向和制动形式影响安装与使用；无刹车应明确记录。" },
  sling: { keys: ["fiber", "construction"], reason: "承力材料及吊带结构与载荷、有效长度共同定义规格。" },
  lubricant: { keys: ["base_oil", "pack"], reason: "基础油体系及净含量是油品选购与计量的基本信息。" },
  "power-cable": { keys: ["conductor", "insulation"], reason: "导体与绝缘材料是电缆基本结构信息。" },
  "circuit-breaker": { keys: ["breaking", "trip"], reason: "分断能力及脱扣特性必须带适用条件，不能只按额定电流匹配。" },
  "switching-supply": { keys: ["mounting"], reason: "安装形式决定电源能否装入目标设备。" },
  "abrasive-paper": { keys: ["abrasive", "backing", "size", "wet_dry"], reason: "磨料、基材、尺寸及干湿适用方式共同区分砂纸规格。" },
  "office-desk": { keys: ["top_material", "frame_material", "dimensions", "assembly"], reason: "桌体材料、尺寸及整装/拆装形式是基本采购信息。" },
  "office-chair": { keys: ["seat_material", "seat_size", "seat_height"], reason: "座面材料、有效尺寸和座高决定基本适配。" },
  "floor-scrubber": { keys: ["clean_tank", "dirty_tank", "power", "brush"], reason: "水箱、供电与刷盘配置限定实际清洗作业能力。" },
  "pet-food": { keys: ["life_stage", "food_role", "ingredients"], reason: "适用阶段、食品用途和标签配料是宠物食品基本识别信息。" },
  racket: { keys: ["frame", "grip", "strung"], reason: "拍框、握把及是否穿线决定球拍实际交付规格。" },
  basketball: { keys: ["cover", "court"], reason: "表皮材质及适用场地与球号共同支撑基本选型。" },
  "food-oil": { keys: ["ingredients", "shelf_life", "storage"], reason: "按实际标签填写配料、保质期和储存条件，形成可比较的食品档案。" },
  "ambiguous-box": { keys: ["structure", "dimensions", "material", "delivery"], reason: "名称有歧义时仍须明确箱体结构、尺寸、材质与交付内容。" },
};

const conditionalFields: Record<string, Record<string, string>> = {
  "threaded-nut": { property_class: "所选材料及产品执行标准规定性能等级时" },
  "hex-nut": { property_class: "所选材料及产品执行标准规定性能等级时" },
  "hex-bolt": { property_class: "所选材料及产品执行标准规定性能等级时" },
  "light-bulb": { cct: "白光照明光源（含可调白光）", dimming: "支持调光时", beam: "定向光源时" },
  "access-camera": { supply_voltage: "采用独立电源输入时；仅通过PoE等接口供电的产品在视频与通信接口记录供电协议" },
  "copy-paper": { packs: "按箱销售时" },
  "floor-scrubber": { runtime: "电池供电机型时" },
};

export function applyRequirements(pack: KnowledgePack): KnowledgePack {
  const policy = requiredFields[pack.id];
  if (!policy) throw new Error(`知识包缺少建档要求审定：${pack.id}`);
  const conditions = conditionalFields[pack.id] ?? {};
  for (const key of [...policy.keys, ...Object.keys(conditions)]) {
    if (!pack.properties.some(p => p.key === key)) throw new Error(`必填规则引用不存在的属性：${pack.id}/${key}`);
  }
  const properties = pack.properties.map((spec): KnowledgeProperty => {
    const p = structuredClone(spec);
    if (p.key === "brand") {
      p.required = true;
      p.description = "商品标示的品牌；确认无品牌填写“无品牌”，未知待补，不能以“无品牌”代替未知。";
      p.reason = "商品身份识别需要明确品牌状态；无品牌也是有效事实。";
    }
    if (p.key === "model") {
      p.condition = "制造商为该商品分配型号或货号时";
      p.reason = "已有制造商标识必须完整记录；无型号的散件用本类规格字段识别。";
    }
    if (policy.keys.includes(p.key)) {
      p.required = true;
      delete p.condition;
      p.reason = policy.reason;
    }
    if (conditions[p.key]) p.condition = conditions[p.key];
    if (p.condition) {
      p.required = false;
      p.requiredWhenApplicable = true;
      p.reason ??= "符合适用条件时，本字段用于识别或适配所交付的配置；不适用时留空。";
    }
    return p;
  });
  return { ...pack, properties };
}

export function requirementLabel(p: KnowledgeProperty): string {
  return p.condition ? (p.requiredWhenApplicable ? "条件必填" : "条件选填") : p.required ? "必填" : "选填";
}
