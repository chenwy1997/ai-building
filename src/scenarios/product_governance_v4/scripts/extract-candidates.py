import json,re,html,collections,hashlib,argparse
from pathlib import Path

ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description='Extract literal candidate evidence from saved VOP receipts, without network access.')
parser.add_argument('--manifest',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--evidence-prefix',default='E')
args=parser.parse_args()
if args.out.exists():parser.error('Output exists; choose a new candidate-pool path')
manifest=json.loads(args.manifest.read_text())
details={r['skuId']:r for r in manifest['details'] if r['status']=='ok'}
clean=lambda x:re.sub(r'\s+',' ',str('' if x is None else x)).strip()
categories=[]
for cat in manifest['categories']:
    if cat.get('reusePilot'):
        source=Path(cat['reusePilot'])
        pool=json.loads((source/'candidate-pool.json').read_text())
        categories.append(dict(id=cat['id'],name=cat['name'],scope=cat['scope'],reusePilot=str(source),products=pool['products'],evidence=pool['evidence'],pool=pool['pool'],stats=pool['stats']))
        continue
    products=[]; evidence=[]; excluded=[]
    for selected in cat['selected']:
        r=details.get(selected['skuId'])
        if not r:continue
        receipt=json.loads(Path(r['receipt']).read_text());d=receipt['data']
        if isinstance(d,list):d=next(x for x in d if str(x['skuId'])==r['skuId'])
        p=dict(sku=str(d['skuId']),spu=str(d.get('spuId') or d['skuId']),brand=clean(d.get('brandName')) or '未提供',title=clean(d.get('skuName')),spec=clean(d.get('wareInfo')),size=clean(d.get('size')),category=str(d.get('category')),receipt=r['receipt'],fetchedAt=receipt['fetchedAt'],url=f"https://item.jd.com/{d['skuId']}.html",issues=[])
        products.append(p)
        pairs={}
        def add(name,value,loc,kind):
            name,value=clean(name),clean(value)
            if not value:return
            key=(name,value)
            if key in pairs:
                pairs[key]['paths'].append(loc);return
            row=dict(id=f"{cat['id'][:8]}-{args.evidence_prefix}{len(evidence)+1:05d}",sku=p['sku'],spu=p['spu'],brand=p['brand'],name=name,value=value,path=loc,paths=[loc],kind=kind,receipt=r['receipt'],productTitle=p['title'],issues=[])
            if value in ['其他','其它','无','暂无','见包装','详见包装','以实物为准','图色','其他/other']:row['issues'].append('占位或含糊值，不当成有效枚举')
            if name in ['抽数','层数'] and value in ['否','是','无','其他']:row['issues'].append('字段值类型或含义异常')
            if name in ['尺寸','规格'] and re.search(r'\d+\s*[*×xX]\s*\d+',value) and not re.search(r'mm|cm|米|毫米|厘米',value,re.I):row['issues'].append('尺寸单位未明确')
            pairs[key]=row;evidence.append(row)
        for i,a in enumerate(d.get('categoryAttrList') or []):
            for j,v in enumerate(a.get('cateAttrValList') or []):add(a['cateAttrName'],v,f'categoryAttrList[{i}].cateAttrValList[{j}]','平台参数')
        for gi,g in enumerate(d.get('paramGroupAttrList') or []):
            for ai,a in enumerate(g.get('paramAttributeList') or []):
                for vi,v in enumerate(a.get('paramAttrValList') or []):add(a['paramAttrName'],v,f'paramGroupAttrList[{gi}].paramAttributeList[{ai}].paramAttrValList[{vi}]','平台参数')
        for i,cells in enumerate(re.findall(r'<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*</tr>',d.get('specificParam') or '',re.S)):
            n,v=[clean(html.unescape(re.sub('<[^>]+>',' ',x))) for x in cells];add(n,v,f'specificParam/table[{i}]','HTML参数')
        for n,k in [('品牌','brandName'),('销售单位','saleUnit'),('供应商','venderName'),('产地','productArea'),('商品重量','weight'),('制造商型号','seoModel')]:
            if d.get(k) is not None:add(n,d[k],k,'系统字段')
        for k in ['length','width','height']:
            if d.get(k) is not None:add('商品长宽高',f'{k}={d[k]}',k,'系统字段')
        for loc,text in [('skuName',p['title']),('wareInfo',p['spec']),('size',p['size'])]:
            for m in re.finditer(r'(?<![A-Za-z0-9])\d+(?:\.\d+)?\s*(?:ml|mL|毫升|L|升)(?![A-Za-z])',text):add('容量片段',m.group(),loc,'原文片段')
            for m in re.finditer(r'\d+(?:\.\d+)?\s*(?:mm|cm|m|毫米|厘米|米)?\s*[*×xX]\s*\d+(?:\.\d+)?(?:\s*[*×xX]\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|m|毫米|厘米|米)(?:\s*/\s*(?:节|张|卷))?',text,re.I):add('尺寸片段',m.group(),loc,'原文片段')
            for m in re.finditer(r'(?<![A-Za-z0-9])\d+(?:\.\d+)?\s*(?:kg|g|千克|克)(?![A-Za-z])(?:\s*/\s*(?:卷|包|张|箱))?',text,re.I):add('重量片段',m.group(),loc,'原文片段')
            for m in re.finditer(r'\d+\s*(?:节|抽|段|张|格|片|卷|包|提|盒|支|件|套|副|双|瓶|桶|台)(?:\s*/\s*(?:卷|包|盒|箱|提|套))?',text):add('数量片段',m.group(),loc,'原文片段')
            for m in re.finditer(r'(?<![A-Za-z0-9])\d+(?:\.\d+)?\s*(?:米|m)(?![A-Za-z])(?:\s*/\s*卷)?',text):add('长度片段',m.group(),loc,'原文片段')
    grouped=collections.defaultdict(list)
    for e in evidence:grouped[e['name']].append(e)
    pool=[]
    for name,rows in grouped.items():
        counts=collections.defaultdict(set)
        for e in rows:counts[e['value']].add(e['spu'])
        pool.append(dict(name=name,skuCount=len({r['sku'] for r in rows}),spuCount=len({r['spu'] for r in rows}),brandCount=len({r['brand'] for r in rows}),kinds=list(dict.fromkeys(r['kind'] for r in rows)),values=[dict(value=k,spuCount=len(v)) for k,v in sorted(counts.items(),key=lambda x:(-len(x[1]),x[0]))],issueCount=sum(bool(r['issues']) for r in rows),evidenceIds=[r['id'] for r in rows]))
    pool.sort(key=lambda p:(-p['spuCount'],p['name']))
    stats=dict(skuCount=len(products),spuCount=len({p['spu'] for p in products}),brandCount=len({p['brand'] for p in products}),sourceFieldNames=len({e['name'] for e in evidence if e['kind'] in ['平台参数','HTML参数']}),allEvidenceRows=len(evidence),searchCandidates=len(cat['candidates']),selected=len(cat['selected']),detailsFailed=sum(p['skuId'] not in details for p in cat['selected']))
    categories.append(dict(id=cat['id'],name=cat['name'],scope=cat['scope'],scopeNote=cat.get('scopeNote'),products=products,evidence=evidence,pool=pool,stats=stats))
assert len(categories)==len(manifest['categories'])
for c in categories:
    assert len(c['products'])==len({p['sku'] for p in c['products']})
    assert len(c['evidence'])==len({e['id'] for e in c['evidence']})
    assert all(Path(e['receipt']).exists() for e in c['evidence'])
args.out.parent.mkdir(parents=True,exist_ok=True)
args.out.write_text(json.dumps(dict(generatedAt=manifest['generatedAt'],categories=categories,extractionScope='Literal parameters and generic number/unit fragments; not a complete domain ontology or SKU fact verification',deepseekRequests=0,productionWrites=0),ensure_ascii=False,indent=2))
for c in categories:
    print(c['name'],c['stats']['skuCount'],'SKU',c['stats']['spuCount'],'SPU')
    print(len(c['pool']),'candidate field names; see output for raw values')
