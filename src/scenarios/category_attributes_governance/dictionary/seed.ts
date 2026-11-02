import type { Dictionary, Property, Unit } from './contracts.ts';

// Project-authored reference definitions, not an imported or certified ETIM/ECLASS catalog.
const units: Unit[] = [
  ['mm','mm','length'],['m','m','length'],['kg','kg','mass'],['g','g','mass'],
  ['V','V','voltage'],['kV','kV','voltage'],['W','W','power'],['kW','kW','power'],
  ['Ah','Ah','charge'],['mAh','mAh','charge'],['ohm','Ω','resistance'],['Mohm','MΩ','resistance'],
  ['kV_per_mm','kV/mm','electric-field-strength'],['count','个','count'],
  ['shore_a','Shore A','shore-a-hardness'],['irhd','IRHD','irhd-hardness'],
].map(([id,symbol,quantity])=>({id:id!,symbol:symbol!,quantity:quantity!}));
const project = {kind:'project-definition' as const,ref:'dictionary/方法与验收.md#定义管理'};
const si = {kind:'unit-reference' as const,ref:'https://www.nist.gov/pml/special-publication-811/nist-guide-si-chapter-4-two-classes-si-units-and-si-prefixes'};
const parker = {kind:'domain-reference' as const,ref:'https://discover.parker.com/oes-webinar-how-to-read-a-rubber-seal-test-report'};
const fluke = {kind:'domain-reference' as const,ref:'https://www.fluke.com/en/learn/blog/insulation-testers/insulation-tester-or-megohmmeter'};
const properties: Property[] = [];
function add(id:string,name:string,definition:string,object:string,type:Property['type'],unitIds:string[]=[],excludedMeanings:string[]=[],qualifications:string[]=[],basis:Property['basis']=[]) {
  properties.push({id:`sh.${id}`,revision:1,name,definition,object,type,quantity:unitIds.length?units.find(u=>u.id===unitIds[0])!.quantity:null,unitIds,aliases:[],qualifications,excludedMeanings,basis:[project,...basis]});
}
add('own.brand','品牌','目标商品自身标注的品牌名称。','目标商品','text',[],['适配品牌','供应商名称','经销商名称']);
add('own.model','制造商型号','制造商用于识别目标商品的完整型号或货号，包含区分规格的后缀。','目标商品','text',[],['适配机型','由品牌推断的型号','电商SKU编号']);
add('compatible.brand','适配品牌','制造商声明目标商品适配的设备品牌；不表示品牌下所有机型均兼容。','目标商品的适配设备','text',[],['商品自身品牌'],['兼容范围以具体适配声明为准']);
add('compatible.model','适配机型','制造商明确声明兼容的设备完整型号。','目标商品的适配设备','text',[],['目标商品自身型号','仅凭相同品牌推断兼容']);
add('own.net_mass','净质量','目标商品本体的质量，不含运输包装；所含电池和配件范围须注明。','目标商品本体','number',['kg','g'],['运输毛质量'],['明确称量范围'],[si]);
for (const [id,name,def] of [
  ['overall_length','总长','按制造商尺寸图定义方向的整体长度。'],
  ['overall_width','总宽','按制造商尺寸图定义方向的整体宽度。'],
  ['overall_height','总高','按制造商尺寸图定义方向的整体高度。'],
  ['body_outer_diameter','本体外径','本体指定圆柱或圆形截面的外直径。'],
  ['bore_diameter','孔径','指定安装孔或通孔的内直径。'],
  ['shaft_diameter','轴径','指定配合轴段截面的外直径。'],
]) add(`geometry.${id}`,name!,def!,'目标商品指定几何部位','number',['mm','m'],['包装尺寸'],['说明尺寸方向、位置及测量状态'],[si]);
add('oring.free_inner_diameter','O形圈自由内径','O形密封圈在未安装、无外加载荷状态下的内直径。','O形密封圈本体','number',['mm'],['沟槽直径','截面直径'],['自由状态；公差另述'],[si]);
add('oring.cross_section_diameter','O形圈截面直径','O形密封圈圆形截面在自由状态下的直径。','O形密封圈本体','number',['mm'],['圈体内径','发热丝直径'],['非圆截面密封圈不直接套用'],[si]);
add('electrical.rated_input_voltage','额定输入电压','制造商为目标商品正常工作规定的输入端额定电压。','目标商品输入端','number',['V','kV'],['输出电压','耐压试验电压','电池平台营销标称'],['明确交流或直流及适用接线方式'],[si]);
add('electrical.rated_input_power','额定输入功率','制造商在规定工作条件下声明的目标商品电气输入功率。','目标商品电气输入端','number',['W','kW'],['机械输出功率','配套整机输入功率','宣传峰值功率'],['说明额定工作条件'],[si]);
add('mechanical.rated_output_power','额定机械输出功率','制造商在额定工况下声明的轴端或指定机械输出端功率。','机械输出端','number',['W','kW'],['电气输入功率','峰值功率'],['明确输出端和额定工况'],[si]);
add('battery.nominal_voltage','电池标称电压','制造商声明的电池或电池组标称电压。','电池或电池组','number',['V'],['最高充电电压','电池平台营销峰值电压'],[],[si]);
add('battery.rated_capacity','电池额定容量','制造商在规定放电条件下声明的电池可输出电荷量。','电池或电池组','number',['Ah','mAh'],['电能Wh','兼容电池的容量'],['说明放电条件；工具裸机不据兼容电池推定']);
add('configuration.battery_included','是否包含电池','目标商品交付配置是否包含内置或随附电池。','目标商品交付配置','boolean',[],['支持电池供电即等于随附电池']);
add('heater.external_lead_count','外部引线数量','目标发热元件引出至外部、用于连接的独立导线根数。','发热元件的外部引线','integer',['count'],['内部发热丝根数','发热回路数量','温控档位数'],['按实物或接线图的独立引出导线计数']);
add('electrical.insulation_resistance','绝缘电阻','规定测试条件下指定绝缘部位两端呈现的电阻。','指定绝缘路径','number',['Mohm','ohm'],['绝缘耐温等级','介电强度','耐压试验电压'],['记录测试电压、测量部位及环境条件'],[si,fluke]);
add('material.dielectric_strength','介电强度','规定试样和试验条件下，绝缘材料发生电击穿时的电场强度。','绝缘材料试样','number',['kV_per_mm'],['绝缘电阻','单独的耐压电压值','热分级'],['记录试样厚度、试验方法及环境条件'],[si]);
add('electrical.withstand_test_voltage','耐压试验电压','指定绝缘部位按规定试验方法施加并满足合格判据的电压。','指定绝缘部位','number',['V','kV'],['额定工作电压','绝缘电阻','击穿电场强度'],['试验持续时间、交流或直流、测量部位及合格判据不可省略'],[si]);
add('heater.cold_resistance','冷态电阻','发热元件在规定冷态温度和接线方式下两端的电阻。','发热元件指定端子','number',['ohm'],['绝缘电阻','工作热态电阻'],['明确温度、端子和串并联关系'],[si]);
add('material.shore_a','邵氏A硬度','通过邵氏A型硬度测试方法获得的压入硬度读数。','适用该测试方法的材料试样','number',['shore_a'],['IRHD硬度','邵氏D硬度'],['记录试验方法和试样条件；不可直接替换其他标度'],[parker]);
add('material.irhd','国际橡胶硬度','按照指定IRHD测试方法获得的橡胶压入硬度读数。','橡胶试样','number',['irhd'],['邵氏A硬度'],['记录具体测试方法和试样条件；不可直接替换其他标度'],[parker]);
add('material.body','本体材质','构成目标商品指定主体部件的材料名称或牌号。','指定主体部件','text',[],['包装材料','表面涂层','内部所有部件材料'],['明确主体部件；材料名单保持开放']);
add('material.heating_element','发热体材质','承担电热转换作用的发热体材料名称或牌号。','发热体','text',[],['绝缘骨架材料','外壳材质'],['区分电阻丝、PTC等发热结构的材料对象']);
add('material.insulating_support','绝缘支撑材质','支撑并绝缘发热体的骨架或基体材料名称或牌号。','绝缘骨架或基体','text',[],['发热体合金','外壳材质']);
add('configuration.sensor_included','是否包含温度传感元件','目标商品交付配置是否含用于测温的传感元件。','目标商品交付配置','boolean',[],['具有温控功能即必然内含传感器']);
add('configuration.sensor_type','温度传感元件类型','目标商品包含或制造商指定配置的测温元件技术类型。','指定温度传感元件','text',[],['仅由用途推断传感器类型'],['有该元件时适用；区分实际包含与可选配置']);

export const seed: Dictionary = {schema:'sanheng-property-dictionary-v1',units,properties};
