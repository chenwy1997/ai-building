import type { Property, Selection } from '../contracts.ts';
export const baseHash='5b0202d213c570c82de4d326d13e87d5bd6a9b187fef932705d8833ed95b89cd';
export const planHash='0903d34bdf855768b6d5eb7783f2fa6047cf6bd7c3fb1abb46f4070afdd2e3b0';
export const evidence={
  hammer:{url:'https://www.bosch-professional.com/gb/en/products/gbh-2-26-06112A3070',claim:'电锤列示夹持接口、冲击能、冲击频率、额定输入功率及按材料区分的钻孔范围。',boundary:'不将该型号数值或电源形式套给整个类目。'},
  cutter:{url:'https://fein.com/en_us/full-accessory-range/hss-annular-cutter-with-3-4-straight-shank-63134550053/',claim:'空心钻头按切削直径、有效切深和柄部连接选型。',boundary:'页面标题与正文材质措辞存在不一致，本轮不据此判定HSS或硬质合金材质，只采用几何选型维度。'},
  blower:{url:'https://www.husqvarna.com/uk/leaf-blowers/125bvx/',claim:'汽油吹风机分别列示气缸排量、轴输出功率、油箱容量、喷嘴工况下风量和风速。',boundary:'某型号带吸叶套件不表示全类都有吸叶功能。'},
  bender:{url:'https://rothenberger.com/at-de/produkte/biegegeraete/tube-bender-set-1-4-5-16-3-8-1-2-24134',claim:'棘轮式弯管工具分别标明可弯管径、材料、弯曲角度及弯曲半径，并有随附模具清单。',boundary:'铜铝适用性及尺寸数值只对所列型号成立，不能据此生成封闭枚举。'},
  scraper:{url:'https://www.bahco.com/int_en/carbon-scrapers-with-plastic-handle-pb_2487_.html',claim:'车辆垫片清除刮刀的长度、刃宽、刀片材料和硬度分别描述。',boundary:'用于支持气缸清理铲刀的工具对象，不证明三横该类目只容纳这一结构。'},
  cap:{url:'https://www.knipex.com/en-uk/products/insulated-tools/self-clamping-slip-on-caps-conical',claim:'制造商存在自夹紧绝缘保护帽/滑套系列，按尺寸区分。',boundary:'不能把同名“绝缘滑套”全部解释为操作杆滑动轴套；最终需核实三横收录商品对象。'},
  anchor:{url:'https://www.fischer-international.com/en/products/facade-systems/undercut-anchors-fzp-ii',claim:'背部锚固件产品系列涉及板厚、锚固深度、直径、螺纹及结构系列。',boundary:'FZP不是“三角卡敲击背栓”的直接等同型号，本轮只作相关锚固维度参考。'},
  tamp:{url:'https://geismar.com/products/double-heads-tamping-module-mb2tl/?lang=us',claim:'液压捣固设备存在多种机型，模块式产品涉及工作头、下插深度及液压配套。',boundary:'大型挖机模块不代表手持或小型铁路捣固机；参数维度需按本机形态限定。'},
};
export type EvidenceKey=keyof typeof evidence;
export interface NewConcept {
  id:string;name:string;definition:string;object:string;type:Property['type'];unitIds:string[];
  qualifiers:string[];from?:string[];sources:EvidenceKey[];
}
export interface Need {
  role:string;propertyId:string;requirement:Selection['requirement'];condition?:string;
  essential:boolean;rationale:string;
}
export interface CaseSpec {slug:string;name:string;scope:string;needs:Need[];issues:string[];sources:EvidenceKey[]}
export const concepts:NewConcept[]=[];
function define(key:string,name:string,definition:string,object:string,type:Property['type']='text',unitIds:string[]=[],qualifiers:string[]=[],from:string[]=[],sources:EvidenceKey[]=[]){
  const id=`sh.hw2.${key}`;concepts.push({id,name,definition,object,type,unitIds,qualifiers,from,sources});return id;
}
// Project-authored concepts. A new scope is a NEW definition, never counted as direct baseline reuse.
export const n={
  dimensions:define('geometry.envelope','外形尺寸','在注明收纳或工作状态下的本品主要外廓尺寸，按长、宽、高或直径明确标识。','目标商品外廓','text',[],['每个数值注明mm等长度单位；不含运输包装']),
  bladeWidth:define('blade.width','工作刃宽','刀刃指定工作段的横向有效宽度。','刮削或剪切工具工作刃','number',['mm']),
  bladeLength:define('blade.length','有效刃长','承担切削或刮削工作的刀刃有效长度，不含夹持或埋入部分。','工具工作刃','number',['mm']),
  bladeMaterial:define('blade.material','工作刃材质','工作刃的基体材料或牌号，不包含握柄材料或表面涂层。','工具工作刃','text',[],[],['sh.hardware.wire_rope_cutter.blade_material']),
  handleMaterial:define('handle.material','手柄主体材质','握持手柄的结构主体材料；外部包覆另述。','工具手柄主体','text',[],[],['sh.hardware.wool_brush.handle_material']),
  bladeShape:define('blade.geometry','工作刃形状','工作刃的轮廓、刃口形式及适用刮削部位；共存特征分项描述。','工具工作刃'),
  bladeMount:define('blade.mount','刀片安装方式','刀片与刀架的固定或可更换连接方式；可更换时注明匹配规格。','刀片与工具本体连接'),
  materialCapacity:define('cut.capacity','声明剪切能力','按工件材料、硬度等级、截面结构和工况分别列示制造商允许的最大剪切尺寸。','剪切工具与工件的适用关系','text',[],['材料/硬度/截面:最大尺寸及单位'],['sh.hardware.combination_pliers.max_cutting_diameter']),
  driveForm:define('tool.drive_form','驱动方式','目标工具产生工作运动的驱动方式，区分手动、电机驱动、外接液压等。','目标工具动力输入'),
  kitList:define('kit.contents','组套组成','列出组套中每种工具、配件或电池充电器的名称、型号或规格及数量；明确是否计入收纳容器。','组套交付内容','text',[],['名称/型号/规格×数量；计数口径与总件数一致'],['sh.hardware.tool_set.tool_composition']),
  kitCount:define('kit.count','组套件数','按声明计数口径统计组套中的工具及配件件数，收纳盒是否计入须明确。','组套交付内容','integer',['count'],['不能把包装数量当工具件数'],['sh.hardware.tool_set.tool_count']),
  kitSpecifications:define('kit.working_specs','工作端规格清单','逐件列示组套内工具的工作端形式、尺寸及制式，不能只给最大与最小规格。','组套内各工具工作端'),
  driveInterface:define('interface.drive','驱动接口规格','与驱动工具或手柄连接的接口形式、尺寸和接头方向；不与工作端规格混淆。','工具或附件驱动连接端','text',[],['注明方头/方孔、六角柄等结构及公英制尺寸']),
  compatibleObjects:define('compatibility.objects','适配对象及范围','制造商明确声明适用的配套工具、设备或接口范围，不由相同品牌或外形推断。','目标商品的配套对象'),
  sectionSize:define('geometry.working_section','工作段截面规格','工作段截面的形状、关键尺寸及测量部位。','指定工作段截面'),
  declaredLimits:define('performance.limits','声明适用范围及限制','制造商针对本品声明的应用对象、使用边界及限制；不能以名称或材质替代性能声明。','目标商品应用关系'),
  mount:define('interface.mount','安装接口尺寸','与配套设备机械安装处的形式及配合尺寸，区分孔距、孔径、轴径和固定方式。','本品安装连接部位'),
  mains:define('electrical.input_spec','输入电源规格','目标电气设备输入侧的AC/DC制式、电压、频率及必要接线信息。','目标商品电源输入端','text',[],['制式:电压V/频率Hz；不混入负载输出侧']),
  containerVolume:define('container.volume','额定或标称容积','制造商声明的容器容积，注明额定有效容积或满口容积口径。','容器内部容积','number',['L']),
  containerLoad:define('container.load','允许装载质量','制造商在指定提携或静置条件下声明的允许装载质量，不包含容器自身质量。','收纳容器装载能力','text',[],['工况:数值kg']),
  containerForm:define('container.form','容器结构','容器的刚性或柔性、折叠结构、开口与盖体等可共存的结构特征。','收纳容器'),
  toolMaterial:define('material.working_body','工作部件材质','承担本工具工作作用的指定部件材料或牌号。','指定工作部件','text',[],['明确部件，不能把涂层当基材']),
  fileShape:define('file.section','锉身截面形状','工作锉身的截面轮廓，按实际形状描述，不将所有精密锉限定为半圆形。','锉削工作部件','text',[],[],['sh.hardware.half_round_file.section_dimensions']),
  fileLength:define('file.working_length','锉削工作长度','用于锉削的工作部分长度，不含锉尾和手柄；按制造商标注口径注明界限。','锉削工作部件','number',['mm'],[],['sh.hardware.half_round_file.length']),
  fileCut:define('file.cut_grade','锉纹粗细等级','制造商标注的锉纹粗细、锉号及所属分级体系。','锉削齿纹','text',[],[],['sh.hardware.half_round_file.tooth_type']),
  filePattern:define('file.cut_pattern','锉纹加工形式','单纹、双纹等锉齿排列与加工形式；未标注时不由粗细等级推断。','锉削齿纹','text',[],[],['sh.hardware.half_round_file.cut_pattern']),
  pipeMaterial:define('bending.pipe_material','适用管材及状态','制造商允许弯曲的管材材料、硬软状态、制造形式及必要表面条件。','弯管工具适用管材','text',[],[],['sh.hardware.pipe_bender.tube_material_applicability'],['bender']),
  pipeSize:define('bending.pipe_size','适用管径与壁厚','按管材和状态逐项记录可弯管外径与壁厚的组合范围；不将公称通径当外径。','弯管工具与管材配合','text',[],['管材/状态:外径×壁厚mm'],['sh.hardware.pipe_bender.max_bend_capacity'],['bender']),
  bendRadius:define('bending.radius','弯曲半径','对应管径和模具的管中心线弯曲半径，倍径表示时注明基准。','弯管成形几何','text',[],[],['sh.hardware.pipe_bender.bend_radius_spec'],['bender']),
  bendAngle:define('bending.angle','弯曲角度范围','制造商声明的可成形弯曲角度范围及必要限制。','弯管成形角度','text',[],['角度值使用°'],['sh.hardware.pipe_bender.bend_angle_range'],['bender']),
  nonSpark:define('non_sparking.limits','防火花适用声明','制造商针对本工具的防火花用途、适用环境和使用限制声明；材料牌号不直接证明认证或Ex等级。','防火花手工具','text',[],[],['sh.hardware.non_sparking_socket.application_limits']),
};
function d(key:string,name:string,definition:string,object:string,type:Property['type']='text',units:string[]=[],sources:EvidenceKey[]=[]) {return define(key,name,definition,object,type,units,[],[],sources);}
const old={brand:'sh.own.brand',model:'sh.own.model',length:'sh.geometry.overall_length',body:'sh.material.body',mass:'sh.own.net_mass',surface:'sh.hardware.surface_treatment',count:'sh.hardware.package_count',inputPower:'sh.electrical.rated_input_power'};
export function need(role:string,propertyId:string,requirement:Selection['requirement']='required',condition?:string,essential=true):Need {
  return {role,propertyId,requirement,...(condition?{condition}:{}),essential,rationale:requirement==='required'?'本轮认为这是识别或核心选型所需维度；缺值需补资料，不编造。':requirement==='conditional'?'只在明确适用条件成立时要求提供。':'辅助描述或特定型号声明，可选填。'};
}
const R=(role:string,id:string)=>need(role,id),O=(role:string,id:string)=>need(role,id,'optional',undefined,false),C=(role:string,id:string,condition:string)=>need(role,id,'conditional',condition);
const identity=()=>[need('品牌',old.brand,'required',undefined,false),need('制造商型号',old.model,'conditional','制造商已分配型号或料号时',false)];
export const cases:CaseSpec[]=[];
function c(slug:string,name:string,scope:string,needs:Need[],issues:string[]=[],sources:EvidenceKey[]=[]) {cases.push({slug,name,scope,needs:[...identity(),...needs],issues,sources});}

c('shower','手持花洒喷头','手持淋浴出水头，不含混水阀、升降杆或整套花洒系统',[
 R('进水连接',d('shower.inlet','进水接口','花洒头与软管连接的螺纹或快接制式、尺寸和内外接头形式。','淋浴头进水连接')),
 R('喷水方式',d('shower.sprays','喷水模式','产品具备的喷射模式及切换方式，允许多种模式共存。','淋浴头出水模式')),
 R('喷面规格',d('shower.face','喷面尺寸与形状','喷面形状和尺寸，圆形记直径、非圆形记长宽。','淋浴头喷面')),
 R('本体材质',old.body),O('表面处理',old.surface),O('流量',d('shower.flow','声明出水流量','在指定动态进水压力和喷水模式下的体积流量。','淋浴头水路性能','text',[])),
 O('适用水压',d('shower.pressure','工作水压范围','制造商声明的允许动态进水压力范围，不能用爆破压力替代。','淋浴头进水工况')),
 O('清洁结构',d('shower.cleaning','喷孔清洁结构','喷孔的可擦洗、可拆卸或其他除垢结构。','淋浴头维护结构')),O('包装数量',old.count)]);
c('heavy_scissors','强力剪刀','工业剪切用剪刀；“强力”不是可剪任意材料的性能等级',[
 R('剪切对象及能力',n.materialCapacity),R('有效刃长',n.bladeLength),R('全长',old.length),R('刃口材质',n.bladeMaterial),
 O('刀刃形式',n.bladeShape),O('手柄主体',n.handleMaterial),O('左右手适用',d('scissors.handedness','操作手向','按刀刃与手柄结构声明的右手、左手或双手适用性。','剪刀操作方式')),O('锁定结构',d('scissors.lock','收纳锁定结构','剪刀闭合收纳时的锁扣或其他锁定结构。','剪刀收纳结构'))]);
c('annular','空心钻头','以环形刃进行取芯钻削的钻头；不把所有开孔器或混凝土钻头都视作同类',[
 R('切削直径',d('annular.diameter','切削直径','钻削后孔的标称直径，不是钻头中心空腔直径。','环形钻削孔径','number',['mm'],['cutter'])),
 R('有效切深',d('annular.depth','有效切削深度','制造商声明的一次钻削有效深度，不是钻头总长。','空心钻头切削部','number',['mm'],['cutter'])),
 R('柄部接口',n.driveInterface),R('刀齿材质',n.bladeMaterial),R('适用材料',n.declaredLimits),
 O('总长',old.length),O('冷却方式',d('annular.cooling','冷却供液方式','钻头允许的冷却润滑或内冷供液结构及限制。','空心钻削冷却')),C('顶针配合',d('annular.pilot','顶针适配规格','需要定位或排芯顶针时的配套顶针尺寸、长度和接口。','空心钻头顶针接口'),'结构需要配套顶针时')],['FEIN页面材质用词存在冲突，未将其材质直接收入枚举。'],['cutter']);
c('charge_kit','电动工具充电组套','由电池、充电器等组成的供电组套；不视为任意电动工具套装',[
 R('组套组成',n.kitList),R('接口平台','sh.hardware.battery_interface'),R('电池数量','sh.hardware.supplied_battery_count'),
 C('电池容量','sh.hardware.supplied_battery_capacity','组套实际包含电池时'),
 C('电池电压','sh.battery.nominal_voltage','组套实际包含电池时'),
 C('充电器输入',n.mains,'组套实际包含充电器时'),C('充电器输出',d('charger.output','充电输出规格','逐端口列出充电器支持的电池体系、电压和额定充电电流及限制。','充电器输出端'),'组套实际包含充电器时'),
 R('兼容范围',n.compatibleObjects),O('充电槽数',d('charger.channels','充电位与通道配置','物理充电位数量以及可同时充电的通道和分配方式。','充电器通道')),
 O('充电时间',d('charger.time','声明充电时间','指定电池型号、容量、初始状态和环境条件下的充电时间。','充电器与电池组合性能'))]);
c('soft_start','缓启动装置','动力工具用缓启动模块或配套控制装置，尚需区分嵌入式与外置式',[
 R('装置形式',d('soft_start.form','装置形式','缓启动功能的嵌入模块、外置控制器或指定附件形式。','缓启动装置')),
 R('适配对象',n.compatibleObjects),R('输入电源',n.mains),R('负载规格',d('soft_start.load','适配负载规格','制造商允许的负载电机类型、电压和电流或功率范围，注明负载侧。','缓启动装置负载侧')),
 R('接线定义',d('soft_start.wiring','接线及端子定义','电源、负载、控制信号端子的标识、接口和连接示意。','缓启动装置电气接口')),
 O('启动过程',d('soft_start.ramp','启动过程设定','声明的缓升时间、可调范围和控制方式；不是正常运行调速范围。','缓启动控制过程')),
 O('安装尺寸',n.mount),O('外形尺寸',n.dimensions)],['需要具体说明书确认输入、负载及控制端；当前资料不足以固定某一电路形式。']);
c('petrol_blower','汽油式吹风机','汽油发动机驱动的园林吹风设备，不含电吹风或电池吹风机',[
 R('携带形态',d('blower.form','携带与操作形态','手持或背负等整机操作形态及其支承方式。','园林吹风整机')),
 R('发动机排量',d('engine.displacement','发动机排量','发动机各气缸工作容积之和。','内燃机','number',['cm3'],['blower'])),
 R('燃料要求',d('engine.fuel','燃料与润滑要求','发动机允许的燃料类型及制造商规定的润滑方式和配油要求。','内燃机供油润滑')),
 R('风量',d('blower.flow','声明风量','指定喷嘴和转速或档位下的体积风量，注明测量位置。','吹风设备出风口','text',[],['blower'])),
 R('风速',d('blower.speed','声明风速','指定喷嘴、档位及测量位置下的风速。','吹风设备出风口','text',[],['blower'])),
 O('净质量',old.mass),O('发动机输出功率','sh.mechanical.rated_output_power'),O('油箱容积',d('engine.tank','油箱容积','制造商声明的燃油箱容积。','燃油箱','number',['L'])),
 O('吹吸配置',d('blower.vacuum','吹吸及集叶配置','是否支持吸叶和粉碎以及实际随附的吸叶、集叶附件。','吹风机可选功能与交付配置'))],[],['blower']);
c('garden_bucket','园艺收纳桶','收纳园艺用品或园林杂物的桶，不推定可盛饮用水、燃料或承压',[
 R('标称容积',n.containerVolume),R('本体材质',old.body),R('容器结构',n.containerForm),R('展开尺寸',n.dimensions),
 O('提携结构',d('container.carry','提携结构','提手、肩带或其他搬运结构及固定形式。','收纳容器提携部')),
 O('允许装载',n.containerLoad),O('排水清洁',d('container.drain','排水与清洁结构','底孔、透水结构或可清洗结构；未知不推定密封。','容器维护结构')),O('包装数量',old.count)]);
c('ratchet_kit','棘轮扳手套装','包括棘轮驱动工具的组套，区分方头棘轮与棘轮梅花等结构',[
 R('组套组成',n.kitList),R('件数',n.kitCount),R('棘轮类型',d('ratchet.form','棘轮工具形式','方头套筒驱动棘轮、棘轮梅花等工具结构与工作端形式。','棘轮工具')),
 R('工作端清单',n.kitSpecifications),C('驱动接口',n.driveInterface,'组套采用可连接套筒或批头的驱动端时'),
 O('棘轮齿数',d('ratchet.teeth','棘轮齿数','制造商声明的棘轮机构齿数；多工具分别注明。','棘轮机构','text',[])),
 O('回转角',d('ratchet.swing','最小回转角','制造商声明完成棘轮往复驱动所需的最小摆动角度；多棘爪机构不能仅凭齿数计算。','棘轮机构')),
 O('换向形式',d('ratchet.reverse','换向方式','驱动方向切换的机构和操作形式。','棘轮机构')),O('各工具主体材质',old.body)]);
c('fold_rule','折尺','由多节尺身铰接形成的折叠长度量具',[
 R('测量长度',d('rule.range','标称测量长度','量具完整展开时标注的长度测量范围上限。','折叠长度量具','number',['mm'])),
 R('刻度体系',d('rule.scale','刻度单位与分度','各测量面上的单位体系及最小刻度间隔。','长度量具刻度')),
 R('尺身材质',old.body),O('允许误差',d('rule.accuracy','长度测量允许误差','制造商依据指定标准、温度和姿态声明的长度测量误差或精度等级。','长度量具性能')),
 O('节数',d('rule.sections','尺身节数','折尺中可独立铰接的尺身节数。','折尺结构','integer',['count'])),O('收纳尺寸',n.dimensions),O('铰接结构',d('rule.joint','铰接及定位结构','尺节间铰链材料、角度定位或锁定结构。','折尺连接部'))]);
c('tool_box_kit','组套工具盒','便携工具组套中的盒装工具；名称可能也用于空收纳盒',[
 R('交付形态',d('kit.delivery_form','是否含工具及交付形态','明确是含工具组套、空收纳盒还是附件配置。','组套交付形态')),
 C('组套组成',n.kitList,'交付包含工具或配件时'),C('组套件数',n.kitCount,'交付包含工具或配件时'),C('工作端规格',n.kitSpecifications,'包含有工作端的工具时'),
 R('盒体尺寸',n.dimensions),R('盒体材质',old.body),O('内部布局',d('case.layout','内部收纳布局','隔层、内托、固定槽位及可调整方式。','工具收纳盒内部')),O('锁扣结构',d('case.closure','开合锁扣结构','收纳盒的盖体、锁扣、铰链和关闭固定结构。','工具收纳盒'))],['需业务确认是否允许空盒归入本类，未修改原类目。']);
c('work_vest','工作背心','工具携带或作业用背心，不默认是高可视警示或防护服',[
 R('尺寸',d('wear.size','尺码与适用体型','制造商尺码及适用胸围、腰围或衣长，注明尺寸是人体范围还是成衣尺寸。','作业背心')),
 R('面料',d('wear.fabric','面料组成','主体面料材质或纤维组成；不由颜色或手感推断阻燃、防静电等性能。','服装主体面料')),
 R('口袋配置',d('vest.pockets','口袋与工具携带结构','工具口袋、挂环和承载固定部件的数量、位置和结构。','工具携带背心')),
 O('调节方式',d('wear.adjust','尺码调节方式','肩部、腰部或侧边调节结构及范围。','背心调节部')),
 O('闭合方式',d('wear.closure','穿脱闭合方式','拉链、搭扣等闭合机构与位置。','服装闭合部')),
 O('性能声明',n.declaredLimits),O('颜色',d('appearance.color','外观颜色','可见外表颜色，不构成材料或安全性能证明。','目标商品外表'))]);
c('replaceable_shank','替换式旋具接头起子杆','扭力螺丝批使用的可换批杆或接头；接口方向需明确',[
 R('工具侧接口',n.driveInterface),R('工作端形式与规格',d('driver.tip_spec','工作端形式与规格','用于配合紧固件凹槽或工具附件的工作端形状、尺寸和结构；区分直接批头与批头夹持座。','旋具工作端')),
 R('适配对象',n.compatibleObjects),R('总长',old.length),R('工作部件材质',n.toolMaterial),
 O('允许扭矩',d('driver.allowed_torque','声明允许扭矩','制造商在规定接头和工况下允许传递的最大工作扭矩。','旋具传动部件','text',[])),
 O('锁定方式',d('driver.retention','批杆锁定方式','批杆或接头与工具座之间防脱落的固定机构。','批杆与手柄连接'))]);
c('y_socket','Y形套筒扳手','三臂Y形手动套筒扳手，不假定存在独立方孔驱动端',[
 R('三个工作端规格',d('y_socket.ends','各臂套筒规格','分别标明Y形扳手各臂套筒工作孔的形式、对边尺寸和制式。','Y形扳手各工作端')),
 R('臂部尺寸',d('y_socket.arms','臂长与总体尺寸','制造商标注的各臂有效长度或总体尺寸，明确测量基准。','Y形扳手几何')),
 R('主体材质',old.body),O('套筒有效深度',d('y_socket.depth','各端套筒有效深度','分别注明各套筒工作孔有效啮合的轴向深度。','Y形扳手工作孔')),
 O('表面处理',old.surface),O('包装数量',old.count)]);
c('compressor_head','空压机气泵头','空气压缩主机机头，不包含储气罐整机',[
 R('压缩结构',d('compressor.structure','压缩机头结构','活塞或其他压缩结构、气缸数量、级数和润滑方式分别说明。','空气压缩机头')),
 R('配套驱动',d('compressor.drive','配套驱动要求','制造商规定的驱动功率、转速范围、旋向和传动方式，不将电机功率当机头耗电。','空压机头驱动输入')),
 R('声明排气量',d('compressor.delivery','声明排气量及口径','明确理论排量或实际排气量；实际值注明转速、排气压力和基准状态。','空气压缩机头气体输送性能')),
 R('工作压力',d('compressor.pressure','额定排气压力','制造商允许持续或规定工况下的排气压力，注明表压或绝压口径。','机头排气端')),
 R('安装接口',n.mount),R('气路接口',d('compressor.ports','进排气接口','进气、排气及必要卸荷接口的位置、连接制式和尺寸。','机头气路接口')),
 O('冷却润滑',d('compressor.service','冷却与润滑要求','规定的冷却方式和润滑油要求，无油式不得强求油量。','机头维护条件')),O('净质量',old.mass)]);
c('gasket_scraper','气缸铲刀','汽车气缸或缸盖垫片、积碳清理用手动铲刮工具；不按气动工具解释',[
 R('工作刃宽',n.bladeWidth),R('工作刃形状',n.bladeShape),R('工作刃材质',n.bladeMaterial),R('总长',old.length),
 O('有效刃长',n.bladeLength),O('适用清理对象',n.declaredLimits),O('手柄主体',n.handleMaterial),O('刀片固定方式',n.bladeMount)],[],['scraper']);
c('paint_scraper','刮刀','油灰、腻子或涂层施工用刮刀，依上级类目确定，不泛化为切削机床刮刀',[
 R('工作刃宽',n.bladeWidth),R('工作刃形状',n.bladeShape),R('工作刃材质',n.bladeMaterial),
 R('刀片刚柔特征',d('scraper.flexibility','刀片刚柔及厚度','刀片厚度或制造商声明的刚性、柔性特征，不由材质名称推断。','涂装刮刀工作片')),
 O('有效刃长',n.bladeLength),O('总长',old.length),O('手柄主体',n.handleMaterial),O('刀片固定方式',n.bladeMount)]);
c('rotary_hammer','电锤','电动冲击钻凿工具，允许有线与充电式，不把冲击电钻等同电锤',[
 R('供电方式',d('tool.power_source','工具供电方式','交流电网、电池等供电方式及配套要求，不能由型号泛称推断。','电动工具供电')),
 R('夹持接口',n.driveInterface),R('单次冲击能',d('hammer.energy','声明单次冲击能','制造商按注明测试方法给出的单次冲击能量；不等于输入功率或总做功。','电锤冲击机构','text',[],['hammer'])),
 R('冲击频率',d('hammer.rate','声明冲击频率','在指定额定或空载工况和档位下每单位时间的冲击次数。','电锤冲击机构','text',[],['hammer'])),
 R('钻孔能力',d('drill.capacity','声明钻孔范围','按工件材料、钻头类型和工作模式分别标明制造商允许的钻孔直径范围。','钻孔工具与工件关系','text',[],['hammer'])),
 R('转速范围',d('hammer.speed','声明转速范围','在指定额定或空载工况及档位下的旋转速度范围，注明单位r/min。','电锤旋转机构','text',[],['hammer'])),
 R('工作模式',d('hammer.modes','工作模式','旋转、锤钻、凿削等实际支持的模式；不假定所有电锤都支持单独凿削。','电锤控制模式')),
 C('输入功率',old.inputPower,'制造商对该供电机型声明额定输入功率时'),C('电源规格',n.mains,'采用外接电源时'),
 C('电池平台','sh.hardware.battery_interface','采用电池供电时'),C('电池电压','sh.battery.nominal_voltage','采用电池供电时'),O('净质量',old.mass)],[],['hammer']);
c('bent_tweezers','弯头镊子','电子作业用弯头精细夹持工具，不推定无磁、ESD或医疗性能',[
 R('尖端形状',d('tweezer.tip','尖端形状及尺寸','夹持尖端的轮廓、宽厚和接触形状，必要时注明齿纹。','镊子尖端')),
 R('弯曲几何',d('tweezer.bend','弯头角度与长度','制造商标注的弯曲角度、弯段长度及测量基准。','镊子弯头')),
 R('总长',old.length),R('主体材质',old.body),O('表面处理',old.surface),O('性能声明',n.declaredLimits)]);
c('ratchet_bender','棘轮式弯管器','以手动棘轮机构推进弯曲的工具，不继承液压设备压力和电压',[
 R('适用管材',n.pipeMaterial),R('管径壁厚',n.pipeSize),R('弯曲半径',n.bendRadius),R('弯曲角度',n.bendAngle),
 R('模具配置',d('bender.dies','模具组成及配合','实际随附或适配的弯管模具规格和接口，区分已随附与可选。','弯管器模具')),
 O('工具尺寸',n.dimensions),O('净质量',old.mass)],[],['bender']);
c('knock_anchor','敲击背栓(三角卡)','原名称和层级保留；背栓与三角卡的具体锚固结构尚待产品图纸确认',[
 R('锚固结构',d('anchor.form','锚固结构与卡件形式','制造商图纸确定的背栓结构、卡件形式和安装原理，不由商品简称推定。','背栓与配套卡件')),
 R('规格尺寸',d('anchor.spec','连接与锚固规格','分别记录螺纹或连接尺寸、总长和锚固部分尺寸。','背栓连接与锚固部分')),
 R('配合基材',d('anchor.base','适用基材与板厚','制造商认可的基材种类和厚度范围，必要时注明材质等级。','锚固件与板材关系')),
 R('孔型及安装',d('anchor.hole','安装孔型与深度','产品说明书规定的孔型、孔径和有效安装深度；未确认时不强定为后扩底孔。','锚固安装界面')),
 R('本体材质',old.body),O('性能声明',n.declaredLimits),O('表面处理',old.surface)],['现有相关厂家资料不是“三角卡敲击背栓”的直接同型证据，安装定义需核图。'],['anchor']);
c('saddle_pad','彩钢瓦马鞍垫','与屋面板波型配合的紧固密封垫件，不等同O形圈',[
 R('适配波型',d('roof.profile','适配板型及轮廓','垫件对应的屋面板波型、峰部轮廓和关键尺寸，不仅用通用板厚描述。','垫件与屋面板配合')),
 R('本体尺寸',n.dimensions),R('紧固孔规格',d('roof.hole','紧固孔规格','垫件紧固孔的孔径或长孔尺寸及位置。','垫件紧固界面')),
 R('结构组成',d('roof.layers','承力及密封层组成','分别说明承力层和密封层是否存在、材料及结构；不默认全部是复合垫。','垫件分层结构')),
 O('密封层材质',d('roof.seal_material','密封层材质','实际存在的密封接触层材料或牌号，不以金属基板材料代替。','屋面垫件密封层')),O('包装数量',old.count)]);
c('angle_cutter','角钢切断工具','角钢冲剪或切断设备，不按普通钳子的线径容量描述',[
 R('驱动形式',n.driveForm),R('角钢能力',d('angle.capacity','允许角钢截面规格','按角钢材料强度等级注明允许切断的边宽、边厚组合及必要限制。','角钢切断工具与工件')),
 R('切断形式',d('angle.cut_form','切断机构及方向','制造商定义的冲剪、切断结构和切口角度能力。','角钢切断机构')),
 C('液压要求',d('hydraulic.input','外接液压要求','需要外接液压源的设备规定的压力、流量、回路和接口要求。','设备液压输入端'),'需要外接液压动力时'),
 C('电源规格',n.mains,'需要外接电源时'),O('安装接口',n.mount),O('外形尺寸',n.dimensions)],['角钢强度等级和切断方式不同会改变能力上限，产品级数值必须有说明书。']);
c('insulating_cap','绝缘滑套','暂按绝缘工具分支中的导体临时遮蔽保护滑套/帽理解，具体对象需业务核实',[
 R('保护对象',d('insulating_cap.scope','遮蔽对象及形式','制造商指定保护的裸露导体、连接端或其他部位及套装方式。','绝缘遮蔽件')),
 R('适配尺寸',d('insulating_cap.fit','适配导体尺寸','保护套可夹持或包覆的导体形状与尺寸范围。','保护套与导体配合')),
 R('有效覆盖尺寸',d('insulating_cap.cover','有效覆盖尺寸','保护套在规定装配状态下的有效覆盖长度、内径或其他关键尺寸。','绝缘遮蔽范围')),
 R('额定用途声明',d('insulating_cap.rating','绝缘用途额定声明','制造商针对该保护件声明的电压制式、适用范围和依据；不得由试验电压推导允许作业电压。','绝缘保护件适用声明')),
 R('材质',old.body),O('固定方式',d('insulating_cap.retention','固定夹持方式','自夹紧或其他保持保护位置的机构。','绝缘滑套固定部'))],['制造商存在此类保护帽，但原类目也可能包含其他绝缘滑动部件；未确认前不定版。'],['cap']);
c('driver_set','普通螺丝批套装','普通手动螺丝批组套；不默认具有绝缘作业能力',[
 R('组套组成',n.kitList),R('件数',n.kitCount),R('工作端清单',n.kitSpecifications),
 R('批杆规格',d('driver_set.shafts','批杆长度及结构清单','逐支注明批杆有效长度和固定或可换杆结构；不把包装尺寸作为杆长。','组套各螺丝批杆')),
 O('工作部件材质',n.toolMaterial),O('手柄材质',n.handleMaterial),O('表面处理',old.surface),O('交付收纳形式',n.containerForm)]);
c('bolt_cutter','断线钳','剪断金属线杆的杠杆剪切工具；不等同所有钢丝绳剪',[
 R('剪切能力',n.materialCapacity),R('全长',old.length),R('刃口材质',n.bladeMaterial),R('刀头结构',n.bladeShape),
 O('刀口调节',d('bolt_cutter.adjust','刀口间隙调节','剪切刀口的间隙或对中调节机构。','断线钳刀头')),
 O('手柄材质',n.handleMaterial),O('刀头可更换性',d('bolt_cutter.replace','刀头更换结构','是否具有可更换刀头及对应接口或配件标识。','断线钳刀头连接'))]);
c('aluminium_basin','铝盆','钳工维修辅助容器；不推定食品接触或化学耐受认证',[
 R('口部规格',d('basin.rim','盆口尺寸与形状','盆口的形状和直径或长宽尺寸。','盆体开口')),
 R('盆深',d('basin.depth','有效盆深','盆口基准面到内底部的垂直深度。','盆体内部几何','number',['mm'])),
 R('主体材质',old.body),O('标称容积',n.containerVolume),O('板材厚度',d('basin.thickness','壁厚','制造商标注测量位置的盆体壁厚，不能由重量推定。','盆体壁','number',['mm'])),
 O('表面处理',old.surface),O('净质量',old.mass),O('包装数量',old.count)]);
c('hydraulic_tamper','液压式捣固机','铁路道床液压捣固设备，手持、轨行与安装模块式需分别描述',[
 R('机型及作业形式',d('tamper.form','捣固机形态','手持、轨行或安装模块等整机形态及作业方式。','铁路捣固设备')),
 R('液压配置',d('tamper.hydraulics','液压系统配置','自带或外接液压动力形式；外接时记录压力、流量和回路接口要求。','捣固设备液压系统','text',[],['tamp'])),
 R('振动参数',d('tamper.vibration','声明振动频率','制造商在规定工况下声明的捣固工作头振动频率，注明单位Hz或每分钟次数。','捣固工作头','text',[],['tamp'])),
 R('捣镐配置',d('tamper.tines','捣镐及工作头配置','工作头数量、每头捣镐数量与配合结构，不以整机重量替代。','捣固机构')),
 R('适用轨道条件',d('tamper.track','适用轨道及作业范围','制造商声明的轨距、枕型及道岔等作业适用条件；仅对受这些条件约束的机型描述。','捣固设备与轨道关系')),
 O('下插能力',d('tamper.penetration','声明下插深度','按制造商测量基准和工况声明的工作头下插深度范围。','捣固机构工作行程')),
 O('外形尺寸',n.dimensions),O('净质量',old.mass)],['现有厂家例证偏模块式，手持和小型设备的属性适用条件仍需分别确认。'],['tamp']);
c('steel_punch','钢冲','金属冲击用冲子，类别可能包含样冲或销冲，不固定单一尖端',[
 R('冲子用途',d('punch.form','冲子类型及用途','制造商标识的样冲、销冲等工作用途和结构。','冲子')),
 R('工作端规格',d('punch.tip','冲头几何规格','按冲子类型注明尖端角度、平头直径或其他工作端尺寸及公差。','冲子工作端')),
 R('总长',old.length),R('工作部件材质',n.toolMaterial),O('柄部截面',n.sectionSize),O('受击端结构',d('punch.strike','受击端结构','受锤击部位的头型、结构及厂家使用限制。','冲子受击端')),O('表面处理',old.surface)],['“钢冲”未限定样冲或销冲，模板以类型字段区分，未编造统一尖角。']);
c('precision_file','精密锉','精密锉削工具，可以有多种截面形状，不继承半圆锉限定',[
 R('截面形状',n.fileShape),R('工作长度',n.fileLength),R('粗细等级',n.fileCut),R('工作部件材质',n.toolMaterial),
 O('齿纹形式',n.filePattern),O('截面尺寸',n.sectionSize),O('总长',old.length),O('包装数量',old.count)]);
c('non_spark_bar','防爆套筒扳杆','用于驱动套筒的防火花手动扳杆，不是套筒本体',[
 R('驱动接口',n.driveInterface),R('扳杆结构',d('bar.form','扳杆形式','滑杆、弯杆或其他扳杆结构及活动连接形式。','套筒驱动扳杆')),
 R('总长',old.length),R('材质',old.body),R('防火花适用声明',n.nonSpark),O('表面处理',old.surface)],['防火花材质名称不等于冲击适用或Ex认证，需产品级声明。']);
