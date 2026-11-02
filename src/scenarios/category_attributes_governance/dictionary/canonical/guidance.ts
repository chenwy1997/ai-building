import type { Dimension, Guidance, GuidanceIndex } from './mounting.ts';

/**
 * Project-authored mounting guidance for the canonical dictionary.
 *
 * Facets are retrieval labels: they decide which properties a selector is shown, not
 * which ones a category gets. Alternates record the confusions that actually occurred in
 * the historical delivery (a designation mounted next to a measured value for the same
 * need); companions record measurements that are only meaningful as a pair.
 *
 * companions 只用于「缺一半就没有意义」的度量：长宽高、层数与单层承重、药品规格与装量。
 * 判据是反证——想得出一个挂了 A 却合理地不挂 B 的类目，只要想得出就不是配对。
 * 已经犯过三次错：额定流量配额定工作压力（阀门与压力表有压力无流量）、量程配测量精度（精度可由精度等级表达）、
 * 织物性能配面料材质（透气膜与口罩也用透气率）。配对被判为必填约束，写宽了会在挂载阶段逼出错误数据。
 *
 * 第四次由法兰分支挂载实测逼出，一次撤掉六组，反例都在法兰分支内：
 * 螺纹标记配牙距与制式（G1/2 与 M20×1.5 的标记本身已编码制式与牙距，粗牙留空是常态）、
 * 牙距配制式（公制粗牙由标准唯一确定牙距，可只给制式）、密封件材质配过流件材质（法兰垫片材质独立成立，
 * 过流部位已由本体材质覆盖）、外径配壁厚（实心轴、法兰颈有外径而无壁厚；壁厚需要外径这条依赖写在壁厚的
 * 选用说明里，不该反向强加到每个外径）、配件部件类型配适配品牌（通用螺栓螺母垫片不限品牌）。
 * 前三次靠人工复审发现，这次是挂载阶段自动逼出来的——配对写宽了，结构检查就会对着正确的模板报错。
 *
 * 第五次由塑料润滑脂分支逼出：包装形态配单包装内数量（400g支装润滑脂有形态而无件数，件数由净含量表达）、
 * 产地配国产进口（只记产地不声明进口状态是常态）。8 个兄弟同一个模板刷出 16 条误报，
 * 说明配对写宽的代价随分支末级数线性放大。
 *
 * 第六次同上：介质相容性配过流件材质。润滑脂本身就是介质，不存在过流部件——凡是商品自己就是介质的类目
 * （润滑剂、清洗剂、试剂）都是反例。
 *
 * 连续三个分支各撤几组之后可以断定：companions 当初被系统性地当成「相关」而不是「缺一半就没意义」在用，
 * 逐分支发现太慢，已按判据一次审完全部 18 组，撤掉 10 组。撤掉的反例都是常见类目形态，不是刁钻例子：
 * 适配品牌配适配型号（通用钻头只声明适配品牌）、防护等级配防爆标志（IP54 而不防爆是常态）、
 * 最大工作压力配额定工作压力、单包装内数量配药品规格（一盒100颗螺钉被要求填药品规格）、
 * 额定承重配层数（单层工作台有承重无层数）、色温配光源类型、手柄形式配手柄材质、
 * 年龄段配性别（童鞋有年龄段无性别）、驱动方口配刀柄形式（套筒有方口无刀柄）。
 *
 * 留下的 9 组是真的缺一半就不成立：整体长宽高互配、O形圈线径配内径（少一个无法订货）、
 * 电池标称电压配额定容量、保质期配储存条件（不给条件的保质期无法核验）、
 * 是否含传感器配传感器类型、服务验收要求配服务范围与数量、药品剂型配药品规格。
 * 新增配对前必须先写出反例并证明想不出来，否则一律用 selectWhen 表达而不是 companions——
 * 配对是必填约束，误报会让复核的人学会忽略结构检查，那比没有这个检查更糟。
 */

const entries: Guidance[] = [];
function add(
  propertyId: string,
  dimension: Dimension,
  facets: string[],
  selectWhen: string,
  relations: { alternativeOf?: string[]; companions?: string[] } = {},
) {
  entries.push({ propertyId, dimension, facets, selectWhen, ...relations });
}

// 身份与溯源：几乎所有实物类目都需要，缺失即为缺陷。
add('sh.own.brand', '身份', ['通用'], '任何有品牌标识的实物商品；无品牌也要按实际记录而非留空。');
add('sh.own.model', '身份', ['通用'], '制造商给出型号、系列号或货号时；纯散装物料可能确实没有。');
add('sh.compatible.brand', '身份', ['配件'], '商品是配件或耗材，需要说明适配哪个品牌的设备时。');
add('sh.compatible.model', '身份', ['配件'], '制造商明确声明兼容的设备型号时；不要仅凭同品牌推断。');
add('sh.origin.production_place', '身份', ['实物', '医药', '化学'], '采购或合规需要区分产地时，尤其医药与化学品。只记产地不声明国产/进口是常态。');
add('sh.accessory.part_type', '身份', ['配件', '兜底类目'], '末级类目是「X配件」这类兜底桶，需要区分桶内是哪个部件时；主机整机不用。通用紧固件与垫片不限品牌，桶内是什么部件与适配哪家设备是两件事。', { alternativeOf: ['sh.category.subtype'] });

// 合规：以代号或标准号表达，不是可运算的量。
add('sh.standard.compliance', '合规', ['通用', '紧固件', '管路', '防护'], '制造商声明了执行标准编号时；不要把参考文献里的标准填进来。');
add('sh.enclosure.ip_code', '合规', ['电气', '仪器', '照明'], '商品有外壳防护等级声明时。代号不得当作数值比较。');

// 材质：描述对象不同则是不同属性。
add('sh.material.body', '材质', ['实物', '紧固件', '工具', '结构件'], '刚性本体、结构件、工具的主体材料。这是最常用的一条材质属性。', { alternativeOf: ['sh.material.wetted', 'sh.material.fabric'] });
add('sh.material.wetted', '材质', ['管路', '流体'], '泵体、阀体、管件等与工作介质直接接触的部件。耐介质性由它决定，本体材质证明不了。', { alternativeOf: ['sh.material.body'] });
add('sh.material.fabric', '材质', ['穿戴', '织物'], '服装、手套、织物类商品的主要面层材料。', { alternativeOf: ['sh.material.body'] });
add('sh.material.heating_element', '材质', ['发热'], '商品含电热转换的发热体时。');
add('sh.material.insulating_support', '材质', ['发热', '电气'], '发热体有绝缘骨架或基体，且其材料影响选型时。');

// 外观
add('sh.appearance.color', '外观', ['实物', '穿戴', '家具'], '颜色影响选购或需要区分规格时；工业件颜色常无意义，不必强挂。');
add('sh.surface.treatment', '外观', ['紧固件', '工具', '结构件', '管路'], '有镀层、涂层或表面防腐处理，且影响耐蚀性与外观时。');

// 几何与质量：成组出现才有意义；公称值与实测总长必须分清。
add('sh.geometry.overall_length', '几何与质量', ['实物', '几何'], '按尺寸图定义方向的整体长度。与紧固件公称长度不是一回事。', { alternativeOf: ['sh.fastener.nominal_length', 'sh.paper.sheet_size_designation'], companions: ['sh.geometry.overall_width', 'sh.geometry.overall_height'] });
add('sh.geometry.overall_width', '几何与质量', ['实物', '几何'], '整体宽度。与总长、总高成组挂载，不要只挂其中一个。', { companions: ['sh.geometry.overall_length', 'sh.geometry.overall_height'] });
add('sh.geometry.overall_height', '几何与质量', ['实物', '几何'], '整体高度。与总长、总宽成组挂载。', { companions: ['sh.geometry.overall_length', 'sh.geometry.overall_width'] });
// 法兰分支试点暴露：原标签只有几何/板材/密封，法兰盘与盲板按管路标签召回时取不到这一条，
// 模型于是把「法兰厚度」报成字典缺口。整体长宽高三条都带实物，厚度是四个整体尺寸里唯一的例外。
add('sh.geometry.overall_thickness', '几何与质量', ['实物', '几何', '板材', '密封'], '板材、垫圈、卷材、法兰盘、盲板等以厚度为关键尺寸的商品；须说明测量部位。');
add('sh.geometry.body_outer_diameter', '几何与质量', ['几何', '管路', '轴承'], '圆柱或圆形截面商品的外直径；须说明测量部位。实心件与法兰颈有外径而无壁厚。', { alternativeOf: ['sh.tool.cutting_diameter'] });
add('sh.geometry.bore_diameter', '几何与质量', ['几何', '轴承', '紧固件'], '安装孔或通孔的内直径。');
add('sh.geometry.shaft_diameter', '几何与质量', ['几何', '轴承', '传动'], '配合轴段的外直径。');
add('sh.own.net_mass', '几何与质量', ['实物'], '商品本体质量，不含运输包装。与定量包装的内容物净质量不是一回事。', { alternativeOf: ['sh.content.net_mass'] });
add('sh.apparel.size_designation', '几何与质量', ['穿戴'], '服装、鞋靴、手套等按尺码体系标示规格的商品。代号不可换算为实测尺寸。');
add('sh.fastener.shank_nominal_diameter', '几何与质量', ['紧固件'], '铆钉、销等以杆径为公称规格的紧固件，值是毫米数值。', { alternativeOf: ['sh.pipe.nominal_diameter_dn'] });
add('sh.fastener.nominal_length', '几何与质量', ['紧固件'], '螺钉、螺栓等按头型标准标示公称长度的紧固件；是否含头由标准决定。', { alternativeOf: ['sh.geometry.overall_length'] });
add('sh.oring.free_inner_diameter', '几何与质量', ['密封'], 'O形密封圈；自由状态内径，不是沟槽直径。', { companions: ['sh.oring.cross_section_diameter'] });
add('sh.oring.cross_section_diameter', '几何与质量', ['密封'], 'O形密封圈截面直径，与自由内径成组使用。', { companions: ['sh.oring.free_inner_diameter'] });

// 性能：输入与输出、额定与最大、代号与数值，都是历史上反复混填的地方。
add('sh.electrical.rated_input_voltage', '性能', ['电气', '工具', '仪器', '照明'], '设备、工具、电机的额定工作电压数值。', { alternativeOf: ['sh.electrical.rated_voltage_designation'] });
add('sh.electrical.rated_voltage_designation', '性能', ['电气', '电缆'], '电缆电线以分数形式标示额定电压等级时，如0.6/1kV；不要简化成单一数值。', { alternativeOf: ['sh.electrical.rated_input_voltage'] });
add('sh.electrical.rated_input_power', '性能', ['电气', '工具', '照明'], '电气输入侧的额定功率。整机与工具通常填这条。', { alternativeOf: ['sh.mechanical.rated_output_power'] });
add('sh.mechanical.rated_output_power', '性能', ['电机', '传动', '泵'], '电机或泵的轴端输出功率。与输入功率数值不同且不可互相推导。', { alternativeOf: ['sh.electrical.rated_input_power'] });
add('sh.battery.nominal_voltage', '性能', ['电池', '工具'], '含电池或电池组的商品。', { companions: ['sh.battery.rated_capacity'] });
add('sh.battery.rated_capacity', '性能', ['电池', '工具'], '电池额定容量；裸机不得据兼容电池推定。', { companions: ['sh.battery.nominal_voltage'] });
add('sh.electrical.insulation_resistance', '性能', ['电气', '绝缘'], '有绝缘电阻声明及测试条件时。');
add('sh.electrical.withstand_test_voltage', '性能', ['电气', '绝缘'], '有耐压试验声明时；与额定工作电压不同。');
add('sh.material.dielectric_strength', '性能', ['绝缘'], '绝缘材料以击穿场强表征性能时；与绝缘电阻是两回事。');
add('sh.material.shore_a', '性能', ['密封', '橡胶'], '硬度按邵氏A方法测得时。', { alternativeOf: ['sh.material.metal_hardness', 'sh.material.irhd'] });
add('sh.material.irhd', '性能', ['密封', '橡胶'], '硬度按IRHD方法测得时；两种标度不可互换。', { alternativeOf: ['sh.material.shore_a'] });
add('sh.heater.cold_resistance', '性能', ['发热'], '发热元件有冷态电阻声明时。');
add('sh.pressure.nominal_rating', '性能', ['管路', '流体'], '管路元件以PN或Class标示压力等级时。等级代号不等于任一温度下的允许工作压力。', { alternativeOf: ['sh.pressure.rated_working'] });
add('sh.pressure.rated_working', '性能', ['管路', '流体', '气动'], '以压力数值规定正常连续工作压力时。', { alternativeOf: ['sh.pressure.nominal_rating'] });
add('sh.pressure.max_working', '性能', ['管路', '流体', '气动'], '制造商另行规定最高工作压力时；与额定工作压力是两个口径。');
add('sh.vessel.nominal_capacity', '性能', ['容器', '清洁', '实验'], '容器、腔体、箱体能装多少。与实际装了多少的内容物净体积不同。', { alternativeOf: ['sh.content.net_volume'] });
add('sh.shelflife.unopened', '性能', ['化学', '医药', '食品'], '有保质期声明的商品；贮存条件由制造商声明，条件不同不可互换。', { companions: ['sh.storage.condition'] });
add('sh.display.method', '性能', ['仪器', '仪表'], '有读数或状态显示部件时。');

// 接口：决定能不能装上、接得上。
add('sh.pipe.connection_form', '接口', ['管路', '流体', '气动'], '与管道或管路系统对接的结构形式。', { alternativeOf: ['sh.interface.type'] });
add('sh.pipe.nominal_diameter_dn', '接口', ['管路', '流体'], '管路元件的DN公称通径代号。DN无量纲，不得换算为毫米。', { alternativeOf: ['sh.fastener.shank_nominal_diameter'] });
add('sh.thread.designation', '接口', ['紧固件', '管路', '气动'], '有螺纹连接且需要完整螺纹标记时；保留完整代号，不拆成数值。完整标记本身已编码制式与牙距，不必再单独挂。');
add('sh.install.method', '接口', ['电气', '照明', '安防', '家具'], '安装固定方式影响选型时；与管路连接形式不是一回事。');
add('sh.power.supply_mode', '接口', ['电气', '仪器', '安防'], '供电来源方式；电压数值另用额定输入电压，不要填成220V。', { alternativeOf: ['sh.actuation.method'] });
add('sh.heater.external_lead_count', '接口', ['发热'], '发热元件需要说明外部引线根数以便接线时。');

// 包装：定量包装商品的关键，且必须拆开不能合写。
add('sh.packaging.form', '包装', ['化学', '医药', '清洁', '耗材'], '最小销售包装的容器形态。单件销售的容器（如400g支装润滑脂）有形态而无件数。');
add('sh.packaging.unit_quantity', '包装', ['耗材', '紧固件', '办公', '医药'], '按包、盒、套销售且一包内含多件时。');
add('sh.content.net_mass', '包装', ['化学', '医药', '清洁', '食品'], '定量包装商品以质量标示内容物时，不含容器。', { alternativeOf: ['sh.own.net_mass', 'sh.content.net_volume'] });
add('sh.content.net_volume', '包装', ['化学', '清洁', '实验'], '定量包装商品以体积标示内容物时，不含容器。', { alternativeOf: ['sh.content.net_mass', 'sh.vessel.nominal_capacity'] });

// 交付：交付配置与服务，不是商品本体的物理属性。
add('sh.configuration.battery_included', '交付', ['电池', '工具'], '同一型号存在含电池与裸机两种交付时。');
add('sh.configuration.sensor_included', '交付', ['发热', '仪器'], '交付是否含测温元件影响选型时。', { companions: ['sh.configuration.sensor_type'] });
add('sh.configuration.sensor_type', '交付', ['发热', '仪器'], '确认含测温元件后说明其技术类型。', { companions: ['sh.configuration.sensor_included'] });
add('sh.service.acceptance_requirement', '交付', ['服务'], '服务类末级类目；不用于实物商品。', { companions: ['sh.service.scope_and_quantity'] });

// 第2批新增。兜底类目的细分维度、区间值的上下限配对、服务类交付属性是本批的三个新族。
add('sh.category.subtype', '身份', ['兜底类目'], '末级类目是「其他X」「X用品」「成套设备」这类兜底桶，需要区分桶内细分类别时；类目本身已明确的不用。', { alternativeOf: ['sh.accessory.part_type'] });
add('sh.tool.cutting_diameter', '几何与质量', ['刀具', '金属加工'], '刀具、钻头等加工出回转表面的商品；是加工出的孔径，不是刀柄外径。', { alternativeOf: ['sh.geometry.body_outer_diameter'] });
add('sh.geometry.wall_thickness', '几何与质量', ['管路', '流体'], '管材、管件、空心壳体；要确定内径须同时给外径，但外径本身不以壁厚为前提。');
add('sh.geometry.shape', '几何与质量', ['实物'], '外形类别影响选型时；不能用它顶替具体尺寸属性。');
add('sh.structure.tier_count', '几何与质量', ['货架', '家具', '存储'], '有分层结构的商品；与单层承重成对才能判断总承载。');
add('sh.electrical.rated_current', '性能', ['电气', '工控', '焊接'], '有额定电流声明的电气商品；断路器须区分整定电流与壳架电流。');
add('sh.mechanical.rated_load', '性能', ['货架', '家具', '存储', '起重'], '承载类商品；须说明均布或集中载荷与支撑方式。');
add('sh.fastener.property_class', '合规', ['紧固件'], '紧固件按标准标示性能等级时，如8.8、A2-70。', { alternativeOf: ['sh.material.strength_grade'] });
add('sh.material.strength_grade', '合规', ['建材'], '水泥混凝土等建材按标准标示强度等级时，如42.5、C30。', { alternativeOf: ['sh.fastener.property_class'] });
add('sh.fluid.compatible_media', '性能', ['管路', '流体', '仪器'], '接触或处理工作介质的商品；只记录制造商声明，不由材质推断。');
add('sh.metrology.accuracy_class', '性能', ['仪器', '仪表', '轴承'], '按分级体系标示精度等级时，如0.5级、P0、C3。', { alternativeOf: ['sh.metrology.measurement_accuracy'] });
add('sh.metrology.measurement_accuracy', '性能', ['仪器', '仪表'], '以误差限表示精度时，如±0.5%FS；参照基准不可省略。', { alternativeOf: ['sh.metrology.accuracy_class'] });
add('sh.imaging.resolution', '性能', ['仪器', '安防', '办公'], '有显示屏或成像器件的商品，值为像素写法。');
add('sh.storage.condition', '性能', ['化学', '医药', '食品'], '有贮存要求的商品；它是保质期成立的前提。', { companions: ['sh.shelflife.unopened'] });
add('sh.lighting.source_type', '性能', ['照明'], '灯具或照明装置；与灯头代号、色温、配光形式分开。');
add('sh.control.method', '接口', ['电气', '仪器', '办公', '工控'], '操作者如何下指令；与执行机构的驱动方式不是一回事。', { alternativeOf: ['sh.actuation.method'] });
add('sh.actuation.method', '接口', ['管路', '流体', '起重', '输送'], '执行机构用什么动力；电动工具的市电或电池取用方式归供电方式。', { alternativeOf: ['sh.control.method', 'sh.power.supply_mode'] });
add('sh.interface.type', '接口', ['电气', '办公', '安防', '工控'], '电气或数据接口形式；与管路连接形式、安装方式分开。', { alternativeOf: ['sh.signal.output_type', 'sh.pipe.connection_form'] });
add('sh.material.handle', '材质', ['工具', '五金', '清洁'], '有手柄或握持部位且其材料影响选型时；与本体材质并存，不互相替代。');
add('sh.handle.type', '几何与质量', ['工具', '五金', '清洁'], '手柄结构形式影响选型时。', { alternativeOf: ['sh.tool.shank_type'] });
add('sh.appearance.style', '外观', ['家具', '生活'], '制造商标示了设计风格且影响选购时；属主观描述，按标注记录。');
// 第3批实测把原「适用人群」拆成性别与年龄段两条：历史取值里「女童」同时落在两边，是必须拆开的证据
add('sh.applicability.gender', '身份', ['穿戴', '运动', '生活'], '规格本身区分性别时，如男款女款；男女同款按中性记录，不作医疗主张。');
add('sh.applicability.age_band', '身份', ['穿戴', '运动', '生活'], '规格本身区分年龄段时，如童款与成人款；不作医疗主张。');
add('sh.commercial.customisable', '交付', ['家具', '标识'], '供应商提供定制交付时；属供货能力，不是物理属性。');
add('sh.service.scope_and_quantity', '交付', ['服务'], '服务类末级类目：交付包含哪些作业及计量数量。', { companions: ['sh.service.acceptance_requirement'] });
add('sh.service.area', '交付', ['服务'], '服务类末级类目：可覆盖交付的地理范围。');
add('sh.service.type', '交付', ['服务'], '服务类末级类目：交付形态类别。');
add('sh.service.provider', '交付', ['服务'], '服务类末级类目：区分原厂、授权服务商与第三方。');
add('sh.service.lead_time', '交付', ['服务'], '服务类末级类目：时间承诺；须说明计时起点与工作日口径。', { alternativeOf: ['sh.service.cycle'] });

// 第3批新增。医药合规、润滑与化学品、工具接口配合是本批的三个新族。
add('sh.material.metal_hardness', '材质', ['金属加工', '刀具', '紧固件', '五金'], '金属件或热处理表面有硬度要求时；取值必须带 HRC/HB/HV 标尺代号。', { alternativeOf: ['sh.material.shore_a'] });
add('sh.material.density', '几何与质量', ['化学', '建材', '实验'], '材料或产品密度影响用量换算或运输时；须注明测定温度。');
add('sh.material.seal', '材质', ['管路', '流体', '气动', '密封'], '有密封元件且其材质决定介质相容性与温度上限时；不能由本体材质推断。垫片材质独立成立，不以过流件材质为前提。');
add('sh.chemical.physical_form', '外观', ['化学', '实验', '医药'], '化学品或制剂需说明常温常压下的物态时；颜色另用颜色属性。', { alternativeOf: ['sh.pharma.dosage_form'] });
add('sh.chemical.flash_point', '合规', ['化学', '实验', '润滑'], '易燃液体类商品；是危险品分类与运输条件的判据，须注明开口或闭口。');
add('sh.fluid.dynamic_viscosity', '性能', ['化学', '胶粘', '润滑'], '以 mPa·s 表达粘度的流体或胶粘剂；须注明测定温度。', { alternativeOf: ['sh.fluid.kinematic_viscosity'] });
add('sh.fluid.kinematic_viscosity', '性能', ['润滑', '化学'], '以 mm²/s 表达粘度的油品；须注明测定温度，40℃与100℃不可混用。', { alternativeOf: ['sh.fluid.dynamic_viscosity'] });
add('sh.fluid.volumetric_flow', '性能', ['管路', '流体', '气动', '泵'], '有额定流量声明的流体设备；必须说明对应工况，但工况点未必是额定工作压力，因此不与它强制配对。');
add('sh.lubricant.base_oil_type', '材质', ['润滑', '化学'], '润滑剂类商品；基础油类别决定与密封件及塑料的相容性。');
add('sh.pharma.dosage_form', '身份', ['医药'], '药品或类似制剂；按药典标示的剂型名称记录。', { alternativeOf: ['sh.chemical.physical_form'], companions: ['sh.pharma.strength'] });
add('sh.regulatory.approval_number', '合规', ['医药'], '实施批准文号管理的药品类商品；按证照原文完整记录。', { alternativeOf: ['sh.regulatory.registration_number'] });
add('sh.regulatory.registration_number', '合规', ['医药', '器械'], '实施注册管理的医疗器械类商品；一个商品通常只有批准文号或注册证号其中一种。', { alternativeOf: ['sh.regulatory.approval_number'] });
add('sh.hazardous.ex_marking', '合规', ['电气', '仪器', '照明', '安防', '工具'], '用于爆炸性危险场所的商品；须按铭牌完整记录三段标志。');
add('sh.origin.import_status', '身份', ['医药', '器械', '生活'], '采购或合规需要区分国产与进口时；若与产地并存两者必须一致。');
add('sh.thread.pitch', '接口', ['紧固件', '管路', '金属加工'], '细牙螺纹或需明确牙距时；粗牙由标准唯一确定可留空。');
add('sh.thread.system', '接口', ['紧固件', '管路', '气动', '金属加工'], '需说明螺纹标准体系时；同一通径的 G 与 NPT 不可互换。公制粗牙的牙距由标准唯一确定，只给制式即可。');
add('sh.signal.output_type', '接口', ['仪器', '仪表', '工控', '气动'], '对外输出测量或状态结果的商品；模拟量须给完整量程写法。', { alternativeOf: ['sh.interface.type'] });
add('sh.tool.drive_size', '接口', ['工具', '五金'], '套筒等与扳杆或风批配合的商品；是配合代号不是实测尺寸。', { alternativeOf: ['sh.tool.across_flats'] });
add('sh.tool.shank_type', '接口', ['工具', '五金', '金属加工', '刀具'], '刀具、钻头、批头装入机具的柄部形式；与握持手柄不是同一部位。', { alternativeOf: ['sh.handle.type'] });
add('sh.rotation.no_load_speed', '性能', ['工具', '五金', '金属加工'], '有回转输出的电动或气动工具；冲击频率是另一个量，不填这里。');
add('sh.cooling.method', '性能', ['焊接', '电气', '传动', '工控'], '有运行发热需排出的设备；直接决定负载持续率。');
add('sh.lighting.colour_temperature', '性能', ['照明'], '灯具或光源；「暖白」「冷白」须换成标称数值，可调则记范围。');
add('sh.closure.method', '几何与质量', ['穿戴', '防护', '箱包'], '服装鞋帽箱包需说明开合结构时。');
add('sh.structure.foldable', '几何与质量', ['运动', '存储', '家具', '生活'], '有折叠收纳结构的商品；应同时记录折叠后尺寸。');
add('sh.applicability.season', '身份', ['穿戴', '运动', '防护'], '制造商按规格标示适用季节时；按标注记录，不自行判定。');
add('sh.service.cycle', '交付', ['服务'], '服务类末级类目：多久做一次；与履约时间是两回事。', { alternativeOf: ['sh.service.lead_time'] });

// q-规格 实测新增。这三条是「规格」这个占位名下唯一三个已有属性接不住的真概念。
add('sh.pharma.strength', '身份', ['医药'], '药品或制剂需标示单位制剂含量时；按药典原文记录，件数另填单包装内数量。', { companions: ['sh.pharma.dosage_form'] });
add('sh.tool.across_flats', '接口', ['工具', '五金'], '扳手钳口或套筒内六角的对边尺寸；与驱动方孔是套筒两端两个不同尺寸。', { alternativeOf: ['sh.tool.drive_size'] });
add('sh.paper.sheet_size_designation', '几何与质量', ['办公', '纸品'], '纸质商品按 A/B 系列或传统开本标示幅面时；需精确尺寸另填外形长宽。', { alternativeOf: ['sh.geometry.overall_length'] });

// q-区间值类型 实测裁定新增。区间是一个值而不是两条属性，量程按被测量的量分列。
add('sh.thermal.working_temperature', '性能', ['管路', '流体', '仪器', '工控', '化学', '密封'], '有允许工作温度声明时；须说明是环境温度还是介质温度，上下限不得只填一侧。', { alternativeOf: ['sh.thermal.control_range'] });
add('sh.thermal.control_range', '性能', ['实验', '办公', '化学'], '能主动控温的设备（恒温箱、水浴、控温台）；这是能力不是环境限值。', { alternativeOf: ['sh.thermal.working_temperature'] });
add('sh.metrology.measuring_range_temperature', '性能', ['仪器', '仪表'], '仪器测的是温度时；选错量程属性等于选错被测量的量。', { alternativeOf: ['sh.metrology.measuring_range_length', 'sh.metrology.measuring_range_pressure'] });
add('sh.metrology.measuring_range_length', '性能', ['仪器', '仪表', '五金'], '仪器测的是长度或位移时。', { alternativeOf: ['sh.metrology.measuring_range_temperature', 'sh.metrology.measuring_range_pressure'] });
add('sh.metrology.measuring_range_pressure', '性能', ['仪器', '仪表', '管路', '气动'], '仪器测的是压力时。', { alternativeOf: ['sh.metrology.measuring_range_temperature', 'sh.metrology.measuring_range_length'] });

// q-功能 业务裁定新增。只收「功能」里有单一国标测试方法的三项；标签本身不构成取值，须补实测值。
add('sh.textile.air_permeability', '性能', ['穿戴', '织物', '防护'], '织物或透气材料需量化透气能力时；须注明测试压差，与透湿量不是同一个量。');
add('sh.textile.hydrostatic_pressure', '性能', ['穿戴', '织物', '防护'], '防水织物需量化防水能力时；「防泼水」属沾水等级另行表达。');
add('sh.textile.upf_rating', '合规', ['穿戴', '织物'], '织物标注防紫外线时；按 GB/T 18830 的 UPF 等级记录，不用化妆品的 SPF。');

export const guidance: GuidanceIndex = { schema: 'sanheng-mounting-guidance-v1', entries };

/** Dimensions a physical-goods leaf is expected to cover; services are checked separately. */
export const requiredDimensionsForGoods: Dimension[] = ['身份'];
