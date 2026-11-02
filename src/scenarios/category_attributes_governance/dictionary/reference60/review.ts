import type { Property, Selection } from '../contracts.ts';
export const version='hardware60-reference-v2';
export const inputHashes={
 'hardware30-v1/templates.json':'54165453dd06e98693726b8765495790fe930eec51815fec40ac1beaab2c63c8',
 'hardware30-v1/property-dictionary.json':'5b0202d213c570c82de4d326d13e87d5bd6a9b187fef932705d8833ed95b89cd',
 'hardware-transfer30-v1/templates.json':'f7a26dcbaee28c9676ae5acc370c79bba6a4013914ddb9958b3626d640f39b29',
 'hardware-transfer30-v1/property-dictionary.json':'99fabb58b068da99a825d43f890101253460a163cd46449cdb9ebe2413b3995a',
 'hardware30-v1/unresolved.json':'f49f151bb487970ec7b026ee651844625da18effdc37313a0cf6c5c510fa5373',
 'hardware-transfer30-v1/unresolved.json':'903390d09afdd7c97bcbfa75fadb9554d6d921c218c3fd66d21a9954d1ed0944',
};
export const sources={
 cap:{url:'https://www.knipex-tools.com/products/insulated-tools/specialty-pliers-and-accessories/plastic-slip-caps-2-1000v-insulated/986620',finding:'厂家把该型号定义为裸露电缆端的遮蔽保护件；支持用途、尺寸、额定声明等属性。',boundary:'不据单型号证明三横全部同名商品范围或额定电压。'},
 grass:{url:'https://www.makita.co.nz/products/model/DUM111ZX',finding:'厂家草剪可配草剪刀片与绿篱刀片，分别列示宽度、刀长、往复频率及交付配置。',boundary:'说明同一工具可有多种工作头；不据此把原类目一概认定为轮式割草机或手持草剪。'},
 rail:{url:'https://www.melvelle.com.au/rail-catalogue/tensors-rail-pullers/rail-creep-adjuster/',finding:'厂家分别列出推力、拉力和油缸行程。',boundary:'只支持参数区分，不采用型号数值；轨缝调节不等于轨距调整。'},
 rail2:{url:'https://www.xinrailtech.com/products/rail-gap-adjuster.html',finding:'厂家双向轨缝调整器列示推拉力、活塞行程及液压要求。',boundary:'双向机型不代表所有调整器均能推拉。'},
 heater:{url:'https://www.steinel.de/out/media/datasheet/68639_Data%20sheet%20-%204007841009212%20-%20SPARE%20PART%20HEATING%20ELEMENT%20HG%202620%20EHG.pdf',finding:'官方配件数据表搜索摘要明确指定兼容热风工具系列。',boundary:'本轮PDF全文获取失败，仅把摘要作为兼容关系补充；不声称验证了电气设计、接线或绝缘试验数值。'},
 anchor:{url:'https://www.daring021.cn/product/202505212',finding:'厂家存在敲击式背栓产品；搜索摘要涉及板材干挂。',boundary:'不能证明“三角卡”具体结构；仍保留范围待确认。'},
 tamper:{url:'https://www.stanleyinfrastructure.com/sites/default/files/Railway%20Catalog_2022.04.0.pdf',finding:'官方TT46手持液压捣固工具资料列示供液压力、流量、最大回压、击打频率和柄部规格。',boundary:'型号表存在长度单位换算疑点，不使用其数值；属性层区分击打频率和振动频率，手持设备不强求轨距。'},
 bender:{url:'https://gb.rothenberger.com/gb-en/products/bending-machines/robull-type-e-3-8-2-open-with-accessories-057966x/',finding:'厂家液压弯管器描述管材、弯曲尺寸范围和配套模具。',boundary:'材料、管径、壁厚需配对描述；单型号能力不能成为封闭枚举。'},
};
// These are semantic review decisions for this frozen sample, not runtime keyword rules.
export const audits:Record<string,string>={
 '充电式电钻':'保留软硬连接扭矩、夹头范围、材料分项钻孔能力；电池与裸机交付分开。',
 '弹簧压缩器':'外径、轴向夹持跨度、压缩行程不同；补轴向夹持范围，避免有行程就认为弹簧一定装得下。',
 'O形圈':'保留自由内径与截面、硬度标度、胶料与介质温度条件；不加脱离沟槽工况的承压值。',
 '电动工具电池':'电压、额定容量、化学体系与接口分开；兼容关系不由品牌推定。',
 '剥线钳':'补导体结构及绝缘适用对象；线径与截面积不互换，剥皮长度不同于适用线径。',
 '梅花敲击扳手':'保留尺寸制式与工作头结构；材料不证明敲击额定性能，敲击端与柄部不混写。',
 '半圆锉':'粗细等级与齿纹排列分开；锉身工作长度不含锉尾，截面尺寸是关键规格。',
 '梅花头插件':'接口截面不是插入深度；作用中心距与允许扭矩已经保留。',
 '液压式弯管器':'按管材配对外径与壁厚，模具是核心选型；自带封闭液压系统不必取得内部设定值才有模板。',
 '合金锯片':'保留外径、基体厚度、锯路、孔径、齿数、齿形与最高允许转速，相关几何不合并。',
 '六角套筒':'工作孔和驱动方孔分开；冲击适用性不按颜色推断，短长薄壁可以共存。',
 '绝缘六角螺丝批':'执行标准、使用电压和认证分开；可换杆连接在对应结构下适用。',
 '钢索剪':'剪切能力已按线材分组，删除重复的适用线材列表，保留最大直径及条件。',
 '组套工具箱':'移出运输包装尺寸，补箱体尺寸；工具组成已含规格数量，计件口径不计箱体。',
 '羊角锤':'锤头质量不等于敲击力，锤柄结构和握持包覆分开；羊角结构决定起钉空间。',
 '羊毛刷':'刷毛材料与混毛、刷宽、外露毛长各有对象；产地属于商品通用管理信息，移出专业模板。',
 '工业美工刀':'适配刀片是尺寸、形状及安装配合问题，补厚度与定位结构；刃宽不能独自证明兼容。',
 '水枪':'喷水模式、喷口结构和控制方式分别保留；将重叠的阀门开关描述合入控制方式。',
 '钢丝钳':'剪切能力按材质硬度结构分项；移除重复的材质清单，保留绝缘用途条件。',
 '气动钉枪':'钉长不是全部兼容规格；保留钉件截面冠宽排钉方式，耗气量注明折算工况。',
 '水平尺（工具）':'误差和分辨率分开；水泡方向对气泡式必要，电子供电条件不依赖某个固定枚举词。',
 '冲击型内六角批头':'工作端、驱动端、头型、长度及冲击声明齐备；不强加未经声明的扭矩。',
 '弹簧夹':'补有效夹持深度；夹持开口、伸入深度与总长不同，夹持力需开口工况。',
 '充电式草坪修剪机':'工具形态与上级剪枝剪存在歧义；补往复或旋转工作速度，留作范围条件样板。',
 '液压式轨缝调整器':'补推拉方向、拉力和夹持方式；修正额定压力不等于连续最高压力，行程是油缸有效行程。',
 '热风枪发热芯':'增加电气连接定义；有些元件用端子而非引线，外部引线数改条件必填；兼容电气与机械边界保留。',
 '防爆六角套筒':'制造商用途和冲击声明足以定义字段，实际证书与环境值无需本阶段预填；不把材料当认证。',
 '六角螺柱':'逐端区分内外螺纹、螺距、有效长度；柱体长度与对边宽度各自保留。',
 '地漏':'排水原理与防返溢分开，修正对有水封及复合结构的条件；补声明排水能力与出口方向。',
 '抽屉式工具箱':'抽屉有效内尺寸是容纳能力的核心；总承重与单抽承重不能相加推定。',
 '手持花洒喷头':'进水接口、喷面尺寸、模式及材料齐备；流量以动态压力及模式限定。',
 '强力剪刀':'“强力”不定义性能等级；剪切能力按材料硬度和工件截面声明。',
 '空心钻头':'冲突页面材质不作为枚举；几何、柄部、工作刃材料和适用工件仍可定义，模板不因单例矛盾停摆。',
 '电动工具充电组套':'多块电池须逐型号列电压，不强塞单一数值；补随附充电器状态，充电参数按交付条件。',
 '缓启动装置':'保留装置形式与兼容对象；有独立供电或负载端时才要求对应电气范围，预装插接附件无需另造完整电路图。',
 '汽油式吹风机':'发动机排量、燃料、风量、风速有对象和工况；不用电气输入功率替代轴功率。',
 '园艺收纳桶':'容积口径、展开尺寸、材料和结构齐备；不推定食品、燃料或承压用途。',
 '棘轮扳手套装':'组套组成和完整规格清单保留；齿数不直接计算多棘爪的最小摆角。',
 '折尺':'刻度、量程和准确度各自描述；将允许误差提升为核心选型要求。',
 '组套工具盒':'空盒还是含工具组套缺少三横业务定义，保留形态及条件模板，暂不进入模型评分。',
 '工作背心':'本类按工具携带附件解释；不默认反光、阻燃、防静电或任何防护认证。',
 '替换式旋具接头起子杆':'用于扭力工具的连接部件需要允许扭矩；工作端和工具侧接口分开。',
 'Y形套筒扳手':'三臂工作规格分列，不强加不存在的方孔输入端。',
 '空压机气泵头':'理论排量与实测排气量区分；配套驱动功率不当机头耗电，压力注明绝压或表压。',
 '气缸铲刀':'按汽修分支的垫片积碳清理对象定义，刃宽、形状、材料与总長完整，不因“气缸”误判气动。',
 '刮刀':'按涂装上级定义刮片；厚度刚柔、刃宽、材料分别描述，未引入机床切削参数。',
 '电锤':'工具设计电压不同于随附电池电压；新增电池配置和充电器状态，额定速度与冲击能工况保留。',
 '弯头镊子':'尖端尺寸、弯头角度、材料和长度齐备；无磁和ESD不由不锈钢材质推导。',
 '棘轮式弯管器':'手动棘轮不继承液压压力；管材、壁厚、半径、角度与模具配对。',
 '敲击背栓(三角卡)':'厂家背栓实例不足以确定三角卡与原类目具体构造；保留一般接口和基材维度，暂不评分。',
 '彩钢瓦马鞍垫':'承力层与密封层分开；存在密封层时需材料，结构未含该层时不要求。',
 '角钢切断工具':'截面能力必须同时说明材料强度、边宽边厚；值依说明书不妨碍先定义属性。',
 '绝缘滑套':'厂家证实有裸露线端保护帽；原类目是否还含其他绝缘滑动件未确认，保留用途范围标记。',
 '普通螺丝批套装':'组成清单、工作端及杆长逐支记录；不把普通套装默认为绝缘工具。',
 '断线钳':'剪切刀头不能使用只面向刮削的定义，修正共享刃形定义；按材料硬度分列能力。',
 '铝盆':'口形、口径和盆深足以标识几何；容积需注明口径，不臆测耐化学或食品接触性能。',
 '液压式捣固机':'手持击打式与振动式分开；击打次数不是振动Hz，轨距仅适用于受轨道几何约束机型。',
 '钢冲':'用冲子类型区分样冲与销冲，工作端规格随类型变化；无需虚构统一尖角。',
 '精密锉':'截面尺寸提升为核心；粗细等级保留分级体系，不把形状限定半圆。',
 '防爆套筒扳杆':'扳杆输出端连接套筒，不是被手柄驱动的输入端；改用明确输出接口定义。',
};
export const scopeHolds:Record<string,string>={
 '充电式草坪修剪机':'上级剪枝剪下是否只收手持草剪，还是同时接纳轮式割草机、打草机？确认前只作有范围说明的参考。',
 '组套工具盒':'该类是否允许空收纳盒？含工具与空盒的核心需求不同。',
 '敲击背栓(三角卡)':'“三角卡”对应哪种卡件及安装结构？需要该类代表性商品图或业务定义。',
 '绝缘滑套':'是否只收用于裸露导体遮蔽的绝缘套/帽？若有机械滑动部件，需要另设适用分支。',
};
export type Edit={category:string;kind:'add'|'remove'|'select'|'replace';id:string;target?:string;requirement?:Selection['requirement'];condition?:string;reason:string};
export const edits:Edit[]=[];
const add=(category:string,id:string,reason:string,requirement:Selection['requirement']='required',condition?:string)=>edits.push({category,kind:'add',id,reason,requirement,condition});
const select=(category:string,id:string,requirement:Selection['requirement'],reason:string,condition?:string)=>edits.push({category,kind:'select',id,requirement,reason,condition});
const remove=(category:string,id:string,reason:string)=>edits.push({category,kind:'remove',id,reason});
const replace=(category:string,id:string,target:string,reason:string)=>edits.push({category,kind:'replace',id,target,reason});
export const additions:Property[]=[];
function define(key:string,name:string,object:string,definition:string,qualifications:string[]=[],type:Property['type']='text',quantity:string|null=null,unitIds:string[]=[]){const id='sh.ref60.'+key;additions.push({id,revision:1,name,object,definition,qualifications,type,quantity,unitIds,aliases:[],excludedMeanings:[],basis:[{kind:'project-definition',ref:'dictionary/reference60/review.ts'}]});return id;}
const springSpan=define('spring.axial_span','轴向夹持范围','弹簧压缩工具与弹簧配合','制造商允许上下夹持点之间的初始轴向距离范围，不是压缩行程或弹簧外径。',['夹持形式:最小–最大mm']);
add('弹簧压缩器',springSpan,'轴向能否装入不能由弹簧外径和行程推出。');
const wire=define('stripper.conductor','适用导线与绝缘类型','剥线工具适用对象','允许剥除的导体材料、单股或多股结构、绝缘层材料与电缆结构；不由导体标称面积推断兼容。');
add('剥线钳',wire,'不同绝缘和导体结构会改变剥线适用性。');
const stripLength=define('stripper.length','剥皮长度调节范围','导线轴向剥皮段','具备长度限位机构时可设定的轴向剥皮长度范围。',['数值范围mm']);
add('剥线钳',stripLength,'线径不是剥除长度。','conditional','具有剥皮长度调节或限位机构时');
select('半圆锉','sh.hardware.half_round_file.section_dimensions','required','截面宽厚是精密配合作业的关键规格。');
replace('液压式弯管器','sh.hardware.pipe_bender.max_bend_capacity','sh.hw2.bending.pipe_size','管材、外径与壁厚应成组合，不能只拼最大值。');
select('液压式弯管器','sh.hardware.pipe_bender.hydraulic_pressure_rating','conditional','只在液压匹配或设定需要时强制要求。','需要外接液压源，或该机型对液压压力设定有明确配套要求时');
select('液压式弯管器','sh.hardware.pipe_bender.mold_config','required','配套模具决定实际弯管范围，区分随附和另购。');
select('绝缘六角螺丝批','sh.hardware.insulated_driver.drive_interface','conditional','固定杆工具不需要可换杆连接规格。','采用可换杆结构时');
remove('钢索剪','sh.hardware.wire_rope_cutter.compatible_wire_type','已纳入按线材分组的剪切能力，不重复维护。');
remove('组套工具箱','sh.hardware.tool_set.package_dimensions','运输包装不属于工具箱本体专业属性。');
add('组套工具箱','sh.hw2.geometry.envelope','使用箱体尺寸而非运输包装尺寸。');
select('组套工具箱','sh.hardware.tool_set.box_material','required','箱体本身是该类的核心对象。');
select('羊角锤','sh.hardware.claw_hammer.claw_type','required','羊角结构影响起钉用途。');
remove('羊毛刷','sh.hardware.wool_brush.origin','产地移回通用商品信息，不占行业属性维度。');
const bladeFit=define('knife.blade_fit','刀片厚度及定位配合','美工刀刀架与刀片连接','刀架允许的刀片厚度、孔槽和定位固定结构；不以刃宽或品牌代替配合规格。',['厚度mm；定位孔槽形状/尺寸或制造商兼容刀片系列']);
add('工业美工刀',bladeFit,'补足刀架与刀片的真实安装配合。');
remove('水枪','sh.hardware.water_gun.valve_type','阀门操作与锁定由控制方式统一描述，避免重复。');
remove('钢丝钳','sh.hardware.combination_pliers.cutting_capacity_material','最大剪切能力已按材质逐项记录，删除重复列表。');
select('水平尺（工具）','sh.hardware.level.power_supply','conditional','允许气泡与电子显示共存，不依赖固定枚举。','含电子测量或电子显示部件时');
select('水平尺（工具）','sh.hardware.level.vial_count','conditional','气泡数量和方向是气泡式核心。','包含气泡测量机构时');
const throat=define('clamp.throat','有效夹持深度','夹具可达工作区域','从夹口前缘到限制工件伸入的机构处的有效深度，注明测量基准；不是最大张口或整夹总长。',[],'number','length',['mm']);
add('弹簧夹',throat,'工件可伸入距离独立于夹口开度。');
select('弹簧夹','sh.hardware.package_count','optional','销售包装数量是辅助项，不应凌驾于核心工作尺寸。');
const headSpeed=define('cutting.head_speed','工作头运动速度','修剪工具工作头','按实际工作头说明往复行程频率或旋转速度，不能把二者混为同一物理量。',['工作头/空载或负载:行程/min或r/min']);
add('充电式草坪修剪机',headSpeed,'补工作头类型对应运动参数。');
const railDirection=define('rail.direction','调缝作用方向','轨端纵向相对移动','设备允许的轨缝张开、收拢或双向调节，不与横向轨距调整混淆。');
const pull=define('rail.pull','声明拉力及工况','轨缝调整器拉伸输出','制造商在规定液压条件下允许的额定或最大工作拉力，注明口径，与推力分开。',['额定或最大工作/液压工况:数值kN']);
const railGrip=define('rail.grip','夹轨位置与方式','调整器与钢轨夹持界面','夹持轨头、轨腰或其他指定部位的夹持原理、配合结构和释放方式；不同于允许夹持尺寸范围。');
add('液压式轨缝调整器',railDirection,'单向与双向不同，先定义适用方向。');
add('液压式轨缝调整器',pull,'拉力不必等于推力。','conditional','设备具备收拢轨缝的拉伸功能时');
select('液压式轨缝调整器','sh.hardware.rail_gap_adjuster.max_thrust','conditional','仅有拉伸功能时不要求推力。','设备具备张开轨缝的顶推功能时');
add('液压式轨缝调整器',railGrip,'补真实夹持结构，不能用轨型代替。');
const heaterConnect=define('heater.connection','电气连接与端子定义','发热芯外部电气连接','外部引线、插片、插座等连接形式与端子标识；有多个加热回路或测温端时分别标识，不由线数猜测回路。');
add('热风枪发热芯',heaterConnect,'覆盖无引线而使用端子连接的发热芯。');
select('热风枪发热芯','sh.heater.external_lead_count','conditional','端子连接件不能强填导线根数。','使用外部引线连接时');
select('热风枪发热芯','sh.configuration.sensor_included','required','是否随附测温元件影响电气配套。');
select('热风枪发热芯','sh.compatible.brand','conditional','通用不是品牌取值。','制造商按品牌限定兼容范围时');
const drainFlow=define('drain.flow','声明排水流量及工况','地漏排水通道','在规定水头、入口配置、内芯和测试条件下声明的排水流量；不由管径直接推定。',['水头mm/入口及内芯配置:流量L/s或L/min']);
add('地漏',drainFlow,'排水能力属于核心性能，参数必须带工况。');
const outlet=define('drain.outlet','排水出口方向及连接','地漏与排水管配合','主排水出口的竖向或侧向方向、连接方式和实际配合尺寸；不以公称管径代替所有安装参数。');
add('地漏',outlet,'公称下水管径不足以决定安装配合。');
select('地漏','sh.hardware.floor_drain.water_seal_depth','conditional','复合密封也可能包含水封。','密封结构包含水封时');
select('抽屉式工具箱','sh.hardware.drawer_box.drawer_internal_size','required','决定工具能否放入，应与外形尺寸同时提供。');
const kitVoltage=define('kit.battery_voltages','随附电池电压清单','组套实际包含的电池','逐电池型号标明标称电压与组合方式；不同电压电池不能合并为一个无对象数值。',['电池型号:标称电压V；不以峰值电压替代']);
replace('电动工具充电组套','sh.battery.nominal_voltage',kitVoltage,'组套可含不同电压电池。');
add('电动工具充电组套','sh.hardware.charger_included','先明确充电器是否随附，后续条件才能判断。');
select('缓启动装置','sh.hw2.electrical.input_spec','conditional','指定专用工具控制附件不一定有独立通用输入。','装置具有需独立匹配的电源输入端时');
select('缓启动装置','sh.hw2.soft_start.load','conditional','封闭兼容专用附件以型号匹配，不强求逆向电路数据。','装置具有需独立匹配的负载输出端时');
select('折尺','sh.hw2.rule.accuracy','required','量具允许误差是核心维度，不与刻度最小间隔混淆。');
select('替换式旋具接头起子杆','sh.hw2.driver.allowed_torque','required','扭力工具传动部件需明确允许传递扭矩。');
replace('电锤','sh.battery.nominal_voltage','sh.hardware.tool_battery_voltage','工具设计需要的电压不同于某块实际电池的电压。');
add('电锤','sh.hardware.supplied_battery_count','支持裸机与带电池配置。','conditional','采用电池供电时');
add('电锤','sh.hardware.supplied_battery_capacity','容量依实际随附电池，而非兼容平台。','conditional','实际随附电池时');
add('电锤','sh.hardware.charger_included','电池供电机型交付状态。','conditional','采用电池供电时');
select('彩钢瓦马鞍垫','sh.hw2.roof.seal_material','conditional','实际有密封层时需要材料，不由金属基板替代。','垫件实际具有密封层时');
select('精密锉','sh.hw2.geometry.working_section','required','截面形状不足以确认可达狭小工件尺寸。');
select('液压式捣固机','sh.hw2.tamper.track','conditional','手持捣固件不一定受轨距约束。','轨行或安装机型受轨距、枕型、道岔几何约束时');
select('液压式捣固机','sh.hw2.tamper.vibration','conditional','击打次数不能标成振动Hz。','通过连续振动进行捣固时');
const tampAction=define('tamper.action','捣固作用方式','捣固工作机构','按制造商说明区分连续振动、往复击打或其他作用方式；不由液压驱动名称推定工作原理。');
const tampBlows=define('tamper.blows','声明击打频率','击打式捣固机构','指定供液和负载条件下单位时间内的击打次数，与连续振动频率分开。',['供液/负载:击/min']);
const backPressure=define('hydraulic.back_pressure','允许回油背压','液压工具回油端','制造商允许的回油端压力上限及工况；不等于供油工作压力。',['工况:最大背压MPa或bar']);
add('液压式捣固机',tampAction,'明确工作机理后才能选择频率。');
add('液压式捣固机',tampBlows,'手持液压捣固器可按击打频率描述。','conditional','通过往复击打进行捣固时');
add('液压式捣固机',backPressure,'外接液压回路需匹配回油端限制。','conditional','需要匹配外接液压回油回路时');
const outputDrive=define('bar.output','套筒连接输出接口','扳杆向套筒传力的输出端','用于连接套筒的驱动方头或其他输出接头形式、公称尺寸和保持结构；不误作扳杆接受动力的输入端。',['输出接头形式/尺寸及公英制单位']);
replace('防爆套筒扳杆','sh.hw2.interface.drive',outputDrive,'修复动力传递方向与定义对象不符。');
export const revisions:Array<{id:string;patch:Partial<Property>;reason:string}>=[
 {id:'sh.hardware.half_round_file.tooth_type',patch:{name:'锉纹粗细等级'},reason:'属性名称与实际粗细等级定义对齐。'},
 {id:'sh.hardware.half_round_file.length',patch:{definition:'半圆锉用于锉削的工作部分长度，不含锉尾与手柄。',qualifications:['工作长度mm或英寸；不使用含义不明的“寸”']},reason:'锉尾不是锉削工作长度，统一测量界限。'},
 {id:'sh.hardware.pipe_bender.mold_config',patch:{definition:'逐项记录随附与可选模具的规格、数量及配合管径，明确实际交付与另购。'},reason:'裸机与含模具配置区分。'},
 {id:'sh.hardware.water_gun.control_type',patch:{definition:'操作者通断和调节水流的机构、阀门操作及锁定保持特征；多个可共存特征分别描述。'},reason:'吸收重复的阀门开关类型。'},
 {id:'sh.hardware.spring_clamp.clamping_force',patch:{definition:'在指定夹口开度、夹持位置与测试条件下的弹簧夹夹紧力。',qualifications:['夹口开度mm/测试位置:力N']},reason:'夹持力不能脱离张口和测点。'},
 {id:'sh.hardware.rail_gap_adjuster.stroke',patch:{definition:'制造商声明液压缸或执行机构的一次有效行程，注明测量基准；不必等于最终轨缝变化量。'},reason:'行程与成效分开。'},
 {id:'sh.hardware.rail_gap_adjuster.working_pressure',patch:{definition:'制造商声明的液压额定工作压力及工作制；不将溢流设定、最高瞬时压力或耐压试验值视为额定值。'},reason:'删除额定与连续最高压力的混同。'},
 {id:'sh.hardware.floor_drain.seal_principle',patch:{definition:'隔绝下水道气味的密封原理及组成，可为水封、机械密封或组合结构；无防臭结构时明确无。防返溢能力另列。'},reason:'防臭与防返溢不等价，也不强制存在独立内芯。'},
 {id:'sh.hw2.blade.geometry',patch:{definition:'剪切或刮削工作刃的轮廓、刃口形式与相对工件的位置；共存特征分项描述。'},reason:'共享定义需覆盖剪切，不仅描述刮削。'},
 {id:'sh.hw2.soft_start.wiring',patch:{name:'连接端定义与接线资料',definition:'用于配合的电源、负载或控制端连接形式、标识及配套接线资料；专用预接插头可记录兼容连接器，不强求内部电路图。'},reason:'定义可交付接口信息，不要求拆解专用模块。'},
 {id:'sh.hw2.geometry.working_section',patch:{qualifications:['形状/测量部位:各关键尺寸mm；形状另有字段时仅补测量部位与尺寸，不重复维护']},reason:'截面形状与截面尺寸有交集，规定单一维护口径。'},
];
export const trial10=['充电式电钻','O形圈','梅花头插件','合金锯片','热风枪发热芯','剥线钳','电动工具充电组套','空压机气泵头','液压式捣固机','防爆套筒扳杆'];

// Final compiled-output review: host output interfaces must not reuse accessory input definitions.
const chuck=define('tool.chuck','刀具夹持接口','电锤主机夹持刀具的输出端','主机用于安装钻头或凿头的夹持系统、规格、保持结构及可换夹头配置；与附件接受驱动力的柄部相对应，但不混称主机输入端。',['接口系统/规格；可换夹头注明实际随附与可选']);
replace('电锤','sh.hw2.interface.drive',chuck,'最终成表核对：主机刀具夹持端不能套用附件驱动输入端定义。');
const kitDrive=define('kit.drive_outputs','组套驱动输出接口清单','组套各驱动工具向套筒或批头传力的输出端','逐件标明棘轮或其他驱动工具的输出方头、批头夹持座等结构及尺寸；各端分别注明，不与套筒工作孔或附件输入柄混淆。',['工具名称:输出接口结构/尺寸及公英制单位']);
replace('棘轮扳手套装','sh.hw2.interface.drive',kitDrive,'组套内驱动工具的输出端方向需要明确。');
