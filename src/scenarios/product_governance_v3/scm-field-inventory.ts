import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hash, REQUIRED_SYSTEM_OWNERS } from "./core.ts";

export type FieldRole =
  | "base_business"
  | "technical"
  | "evidence_container"
  | "relation"
  | "legacy_parameter"
  | "unresolved";
const technical = new Set(
  "id createdAt updatedAt deleted creatorId updaterId purchaserId purchaseId isHead productId prototypeId prototypeProductId spuProductId sortInPrototype searchText searchWords spuSearchWords searchWeight rawProductId rawProductInstanceId categoryAttributeVersion sortInSpu".split(
    " ",
  ),
);
const base = new Set(
  "upstreamId isAllowUpstreamPush upstreamSpu upstreamSku vendorSpuId vendorSkuId spuSaleStatus skuSaleStatus isSpuEnable isSkuEnable supplyRelevanceRule vendorId stdCategoryId targetCustomerIds isTargetedProduct costPrice retailPrice earningsRate freightTemplateId vendorFreightTemplateId brandId categoryInstanceId categoryIds afterSaleTypes sku spu isDisabled stdCategoryIdPath vendorName vendorSkuCode vendorSpuCode vendorIsOnSale vendorRelevantSkus sourceLinks upstreamSkuId upstreamSpuId title subTitle saleSpec saleSpecRaw taxCode taxRate mainImages specImage detailImages saleUnit weight height width length upc originPlace packingList warranty priceCost priceBareCost priceRetail priceFactory priceJd priceMarket profitRate supplierShippingTemplateId platformShippingTemplateId supportedShippingMethods shippingTimeNote shippingFrom quantityMin quantityMax quantityStep tagIds specialManagementCategoryCode supportedAfterSalesServiceTypes afterSalesServiceInformation returnPolicies isCustomProduct includesInstallationService isExclusiveCustomerProduct remark unitMin unitMinQua exclusiveCustomerProduct supplierFre deliveryTimeNote tags sceneTags industryTags deliveryType productAttachments".split(
    " ",
  ),
);
const containers = new Set(
  "detailParams parameter detailHtml detailText OTHER_ATTR DETAIL_PARAMS DETAIL_HTML".split(
    " ",
  ),
);
const oldAliases: Record<string, string> = {
  MAIN_TITLE: "title",
  SPEC_TITLE: "saleSpec",
  SPEC_UNITS: "saleUnit",
  MAIN_IMAGES: "mainImages",
  DETAIL_IMAGES: "detailImages",
  SPEC_IMAGE: "specImage",
  COST_PRICE: "priceCost",
  RETAIL_PRICE: "priceRetail",
  UPC_CODE: "upc",
  WEIGHT: "weight",
  PRPDUCT_AREA: "originPlace",
  RELEVANT_UPSTREAM_SKUS: "vendorRelevantSkus",
  JD_SKU: "vendorSkuId",
  SELF_SELLTYPE: "vendorIsOnSale",
  IS_FAST_ARRIVAL: "deliveryType",
  LOGISTICS_TYPE: "deliveryType",
  skuPoolList: "tags",
};
// Classify carrier responsibilities; contents of a parameter container are never blanket-excluded.
export function fieldRole(key: string, relation = false): FieldRole {
  if (relation) return "relation";
  if (key.endsWith("Key")) return "technical";
  if (technical.has(key)) return "technical";
  if (containers.has(key)) return "evidence_container";
  if (base.has(oldAliases[key] ?? key)) return "base_business";
  return "unresolved";
}
export function parsePrismaFields(body: string, model: string) {
  const lines = body.split("\n"),
    start = lines.findIndex((l) => l === `model ${model} {`);
  if (start < 0) throw Error("model not found " + model);
  const rows = [];
  for (let i = start + 1; i < lines.length && lines[i] !== "}"; i++) {
    const m = lines[i]!.match(/^\s+(\w+)\s+([\w\[\]?]+)(.*)$/);
    if (!m || m[1]!.startsWith("@@")) continue;
    const [, key, type, rest] = m,
      typeName = type!.replace(/[?\[\]]/g, "");
    // Prisma enums are scalars too. Relations have @relation, or refer to another model.
    const relation =
      rest!.includes("@relation") ||
      new RegExp(`^model ${typeName} \\{`, "m").test(body);
    const comment = rest!.split("//").slice(1).join("//").trim();
    rows.push({
      model,
      key: key!,
      type: type!,
      line: i + 1,
      comment,
      role: fieldRole(key!, relation),
    });
  }
  return rows;
}
export function pilotSystemFields() {
  const extra = [
    ["title", ["商品名称", "主标题"], ["product.title"]],
    [
      "priceCost",
      ["成本价", "成本价-不含运费", "零售价", "市场价", "出厂价", "京东价"],
      ["product.price"],
    ],
    [
      "unitMin",
      [
        "最小计量单位",
        "销售单位中含最小计量单位数量",
        "销售总卷数",
        "销售总数量",
      ],
      ["sales.min_unit", "sales.total_quantity", "paper.total_rolls"],
    ],
    ["weight", ["商品重量", "物流重量"], ["product.shipping_weight"]],
    [
      "packageSize",
      ["包装长度", "包装宽度", "包装高度"],
      ["product.shipping_size"],
    ],
    [
      "quantityMin",
      ["起订数量", "最小追加数量", "限购数量"],
      ["sales.order_quantity"],
    ],
    ["upc", ["条形码", "UPC码", "UPC条形码"], ["product.upc"]],
    [
      "vendorSkuId",
      ["供应商SKU编码", "供应商SPU编码", "上游SKU", "上游SPU"],
      ["product.upstream_identity"],
    ],
    ["originPlace", ["产地"], ["product.origin"]],
    ["warranty", ["质保期", "质保说明"], ["product.warranty"]],
    [
      "deliveryType",
      ["配送类型", "货期", "支持的发货方式", "售后服务信息"],
      ["product.fulfillment"],
    ],
    ["mainImages", ["主图", "详情图", "规格图", "商品附件"], ["product.media"]],
    [
      "status",
      ["SPU档案状态", "SKU档案状态", "SPU销售状态", "SKU销售状态"],
      ["product.lifecycle"],
    ],
    ["taxCode", ["税收分类编码", "税率"], ["product.tax"]],
    [
      "isCustomProduct",
      ["是否定制品", "是否包含安装服务", "专属客户商品"],
      ["product.service"],
    ],
    ["tags", ["商品标签", "场景标签", "行业标签"], ["product.tags"]],
  ] as const;
  return [
    ...REQUIRED_SYSTEM_OWNERS.map((x) => ({
      key: x.key,
      names: [...x.names],
      conceptKeys: [...x.conceptKeys],
    })),
    ...extra.map(([key, names, conceptKeys]) => ({
      key,
      names: [...names],
      conceptKeys: [...conceptKeys],
    })),
  ];
}
export function systemFieldsFromInventory(
  inventory: { fields: { key: string; comment: string; role: string }[] },
  nativeFields: {
    key: string;
    title: string;
    propertyInstanceId: string;
    role: string;
  }[] = [],
) {
  const table = new Map(pilotSystemFields().map((f) => [f.key, f]));
  const merge = (key: string, name: string) => {
    const existing = table.get(key);
    if (existing) {
      if (name && !existing.names.includes(name)) existing.names.push(name);
      return;
    }
    table.set(key, {
      key,
      names: [name || key],
      conceptKeys: ["system.field." + key],
    });
  };
  for (const f of inventory.fields.filter((f) => f.role === "base_business"))
    merge(f.key, f.comment.split(/[（(，；。]/)[0]?.trim() || f.key);
  for (const f of nativeFields.filter((f) => f.role === "base_business"))
    merge(
      oldAliases[f.key] ?? (f.key || "native-property:" + f.propertyInstanceId),
      f.title,
    );
  return [...table.values()];
}
export async function inventorySource(sourceRoot: string) {
  const path = "prisma/schema.prisma",
    body = await readFile(resolve(sourceRoot, path), "utf8");
  const fields = [
    "Product",
    "ProductInstance",
    "StdProduct",
    "CategoryKeyConfig",
  ].flatMap((m) => parsePrismaFields(body, m));
  const unknown = fields.filter((f) => f.role === "unresolved");
  if (unknown.length)
    throw Error(
      "unmapped SCM scalar fields: " +
        unknown.map((f) => `${f.model}.${f.key}`).join(","),
    );
  const paths = [
    "app/api/external/routes.ts",
    "app/manage/product/product-hub/detail/service.ts",
    "tools/server/productTools/detail/index.ts",
    "tools/server/productTools/detail/const.ts",
    "app/manage/product/(list)/components/SpuDetail.tsx",
    "app/manage/product/(list)/components/SkuDetail.tsx",
    ...["BaseInfo", "SkuInfo", "DetailInfo", "DeliveryInfo", "OtherInfo"].map(
      (n) =>
        `app/manage/product/product-hub/detail/(components)/ProductForm/${n}.tsx`,
    ),
  ];
  const sources = [
    { path, sha256: hash(body) },
    ...(await Promise.all(
      paths.map(async (path) => ({
        path,
        sha256: hash(await readFile(resolve(sourceRoot, path), "utf8")),
      })),
    )),
  ];
  return {
    format: 1,
    version: "20261022",
    scope:
      "本地供应链代码的Product/ProductInstance/StdProduct/CategoryKeyConfig全部字段及所列创建入口；非生产全库盘点",
    sourceRoot,
    sources,
    fields,
    unknown,
    status: "source_verified_pending_business_review",
    limits: [
      "本地代码版本不能证明与生产部署完全一致",
      "CategoryKeyConfig生产自定义映射未由独立接口完整导出；样本原生字段另核对",
      "动态属性容器内容可含真实参数，不整体排除",
      "StdProduct.weight是商品重量，不能排除单卷标称质量；长度宽度同样按对象区分",
    ],
    systemFields: systemFieldsFromInventory({ fields }),
  };
}
