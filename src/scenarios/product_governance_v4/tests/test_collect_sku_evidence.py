import contextlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'collect-sku-evidence.py'
spec = importlib.util.spec_from_file_location('collect_sku_evidence', SCRIPT)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def uuid(n):
    return f'00000000-0000-4000-8000-{n:012d}'


class CollectorTests(unittest.TestCase):
    def frozen_fixture(self, root):
        root_id, cat_a, cat_b = uuid(100), uuid(101), uuid(102)
        ids = [uuid(1), uuid(2), uuid(3)]
        contract = root/'contract.json'
        collector.save(contract, {'attributeContractVersion':1, 'categories':[
            {'categoryId':cat_a,'category':'A','path':'root>A'}, {'categoryId':cat_b,'category':'B','path':'root>B'}],
            'proposals':[{'categoryId':cat_a,'key':'x'}, {'categoryId':cat_b,'key':'y'}]})
        inventory = root/'inventory.json'
        collector.save(inventory, {'rootCategoryId':root_id,'records':[
            {'productId':sku,'spuProductId':uuid(20+i),'productInstanceId':uuid(30+i),'categoryId':cat_a if i<2 else cat_b,'isHead':True}
            for i,sku in enumerate(ids)]})
        scope = root/'scope.json'
        collector.save(scope, {'version':1,'rootCategoryId':root_id,
            'contract':{'path':contract.name,'sha256':collector.hash_file(contract)},
            'inventory':{'path':inventory.name,'sha256':collector.hash_file(inventory)},
            'categoryIds':[cat_a,cat_b],'skuIds':ids})
        return scope,contract,inventory,ids,root_id,cat_a,cat_b

    def test_frozen_manifest_checks_identity_scope_and_input_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); scope,contract,inventory,ids,root_id,cat_a,cat_b=self.frozen_fixture(root)
            plan=collector.load_frozen_scope(scope,contract)
            self.assertEqual([r['skuId'] for c in plan['chosen'] for r in c['selected']],ids)
            preflight=subprocess.run(['python3',str(SCRIPT),'--scope-manifest',str(scope),'--contract',str(contract),'--phase','selection','--out',str(root/'out')],text=True,capture_output=True)
            self.assertEqual(preflight.returncode,0,preflight.stderr)
            query=json.loads(preflight.stdout)['esRequestExample']
            self.assertEqual(query['query']['bool']['filter'],[{'term':{'categoryIds':root_id}}, {'term':{'categoryInstance.categoryId':cat_a}}, {'terms':{'productId':ids[:2]}}])
            self.assertFalse((root/'out').exists())
            data=collector.read_json(scope); data['skuIds']=[ids[0],ids[0]]; scope.write_bytes(collector.json_bytes(data))
            with self.assertRaisesRegex(RuntimeError,'duplicate_frozen_skus'): collector.load_frozen_scope(scope,contract)
            data['skuIds']=[uuid(999)]; scope.write_bytes(collector.json_bytes(data))
            with self.assertRaisesRegex(RuntimeError,'missing_or_ambiguous'): collector.load_frozen_scope(scope,contract)
            data.pop('skuIds'); data['skus']=[{'skuId':ids[0],'categoryId':cat_b}]; scope.write_bytes(collector.json_bytes(data))
            with self.assertRaisesRegex(RuntimeError,'category_mismatch'): collector.load_frozen_scope(scope,contract)
            data.pop('skus'); data['selectionMode']='all_categories'; data['categoryIds']=[cat_b]; scope.write_bytes(collector.json_bytes(data))
            self.assertEqual([r['skuId'] for c in collector.load_frozen_scope(scope,contract)['chosen'] for r in c['selected']],[ids[2]])
            inventory.write_text('{}')
            with self.assertRaisesRegex(RuntimeError,'hash_mismatch'): collector.load_frozen_scope(scope,contract)

    def test_inventory_missing_ids_are_counted_and_cannot_silently_disappear_from_all_categories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); scope,contract,inventory,ids,_,cat_a,_=self.frozen_fixture(root)
            data=collector.read_json(inventory); data['records'].append({'productId':None,'categoryId':cat_a}); inventory.write_bytes(collector.json_bytes(data))
            m=collector.read_json(scope); m['inventory']['sha256']=collector.hash_file(inventory); scope.write_bytes(collector.json_bytes(m))
            cat=collector.load_frozen_scope(scope,contract)['chosen'][0]
            self.assertEqual((cat['availableDocuments'],cat['availableUniqueSku'],cat['invalidProductIdDocuments']),(3,2,1))
            m.pop('skuIds'); m['selectionMode']='all_categories'; m['categoryIds']=[cat_a]; scope.write_bytes(collector.json_bytes(m))
            with self.assertRaisesRegex(RuntimeError,'invalid_inventory_sku_for_all_categories'): collector.load_frozen_scope(scope,contract)

    def test_frozen_collection_keeps_failed_ids_and_only_queries_confirmed_jd(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); scope,contract,inventory,ids,root_id,cat_a,cat_b=self.frozen_fixture(root); out=root/'out'
            def fake_read(config,cat,actual_root,requested):
                self.assertEqual(actual_root,root_id)
                if cat['categoryId']==cat_b: raise OSError('unavailable')
                self.assertEqual(requested,ids[:2])
                return {'records':[{'productId':ids[0], 'spuProductId':uuid(20), 'productInstanceId':uuid(30),
                    'title':'真实白名单标题', 'categoryIds':[root_id], 'categoryInstance':{'categoryId':cat_a},
                    'product':{'upstreamSku':'123','upstreamId':'jd'}}]}
            with patch.object(collector,'es_config',return_value={'ES_NODE':'fixture'}), patch.object(collector,'read_category',side_effect=fake_read), contextlib.redirect_stdout(io.StringIO()):
                collector.do_selection(out,2,contract,scope)
            selection,manifest=collector.verify_frozen(out,contract,scope)
            self.assertEqual(selection['selectedSkuCount'],3)
            self.assertEqual(selection['esReadStatusCounts'],{'ok':1,'missing_from_es':1,'read_failed':1})
            raw=collector.read_json(out/'raw'/'es'/f'{cat_a}.json')
            self.assertEqual(raw['records'][0]['title'],'真实白名单标题')
            self.assertEqual(raw['records'][1]['collectorReadStatus'],'missing_from_es')
            self.assertNotIn('title',raw['records'][1]); self.assertNotIn('product',raw['records'][1])
            def fake_summary(batch,key):
                return {'requestedIds':batch,'capturedAt':'test','status':'ok','rows':[{'skuId':sku,'status':'ok',
                    'data':{'sku':sku,'upstreamName':'本地' if sku==ids[2] else '京东供应链'}} for sku in batch]}
            requested=[]
            def fake_fetch(jd_ids,directory,concurrency): requested.extend(jd_ids); return ({'123':{'status':'read_failed'}},{'123'})
            with patch.object(collector,'load_vars',return_value={'SANHENG_API_KEY':'fixture'}), patch.object(collector,'batch_summary',side_effect=fake_summary), contextlib.redirect_stdout(io.StringIO()):
                collector.do_summary(out,2,contract,scope)
            with patch.object(collector,'vop_cache',return_value={}), patch.object(collector,'fetch_vop',side_effect=fake_fetch), contextlib.redirect_stdout(io.StringIO()):
                collector.do_vop(out,2,contract,scope)
            self.assertEqual(requested,['123'])
            status=collector.read_json(out/'collection'/'vop-status.json')
            self.assertEqual([r['requestStatus'] for r in status['rows']],['read_failed','not_requested_es_unavailable','not_requested_upstream_not_confirmed'])
            self.assertEqual(status['rows'][1]['esReadStatus'],'missing_from_es')
            self.assertEqual({r['sameSkuIdentity'] for r in status['rows']},{'unverified'})
            with self.assertRaisesRegex(RuntimeError,'selection_output_exists'): collector.do_selection(out,2,contract,scope)
            with self.assertRaisesRegex(RuntimeError,'summary_already_collected'): collector.do_summary(out,2,contract,scope)
            (out/'raw'/'es'/f'{cat_a}.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError,'hash_mismatch'): collector.verify_frozen(out,contract,scope)

    def test_frozen_summary_tampering_and_inventory_change_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); scope,contract,inventory,ids,*_=self.frozen_fixture(root); out=root/'out'
            with patch.object(collector,'es_config',return_value={}), contextlib.redirect_stdout(io.StringIO()): collector.do_selection(out,1,contract,scope)
            def summary(batch,key): return {'requestedIds':batch,'capturedAt':'test','status':'ok','rows':[{'skuId':s,'status':'missing_from_response','data':None} for s in batch]}
            with patch.object(collector,'load_vars',return_value={'SANHENG_API_KEY':'fixture'}), patch.object(collector,'batch_summary',side_effect=summary), contextlib.redirect_stdout(io.StringIO()): collector.do_summary(out,1,contract,scope)
            (out/'collection'/'summary.json').write_text('{}')
            with self.assertRaises((RuntimeError,KeyError)): collector.do_vop(out,1,contract,scope)
            inventory.write_text('{}')
            with self.assertRaisesRegex(RuntimeError,'hash_mismatch'): collector.verify_frozen(out,contract,scope)

    def test_es_filters_real_root_and_direct_leaf_and_projects_only_allowed_fields(self):
        query = collector.query_for(uuid(20))
        self.assertEqual(query['query']['bool']['filter'], [
            {'term': {'categoryIds': collector.ROOT_CATEGORY_ID}},
            {'term': {'categoryInstance.categoryId': uuid(20)}}])
        self.assertNotIn('standardCategory', json.dumps(query))
        actual = collector.es_source({'productId': uuid(1), 'title': 'A', 'upstream': {'secret':'bad'},
             'brand': {'name':'品牌', 'extra':'bad'}, 'product': {'upstreamSku':'123', 'upstreamId':'x', 'extra':'bad'},
             'categoryInstance': {'categoryId':uuid(20), 'name':'bad'}, 'unwanted':'bad'})
        self.assertEqual(actual, {'productId':uuid(1),'title':'A','brand':{'name':'品牌'},
             'product':{'upstreamSku':'123','upstreamId':'x'},'categoryInstance':{'categoryId':uuid(20)}})

    def test_frozen_es_query_rejects_returned_ids_outside_requested_list(self):
        root_id, category_id, requested = uuid(90), uuid(91), uuid(1)
        config={'ES_NODE':'https://fixture.invalid','ES_USERNAME':'fixture','ES_PASSWORD':'fixture'}
        def response(product_id): return {'hits':{'total':{'relation':'eq','value':1},'hits':[{'sort':[product_id,'1'],
            '_source':{'productId':product_id,'categoryIds':[root_id],'categoryInstance':{'categoryId':category_id},'title':'fixture'}}]}}
        with patch.object(collector,'post',return_value=response(requested)) as call:
            result=collector.read_category(config,{'categoryId':category_id},root_id,[requested])
            self.assertEqual(result['records'][0]['productId'],requested)
            self.assertEqual(call.call_args.args[1]['query']['bool']['filter'][-1],{'terms':{'productId':[requested]}})
        with patch.object(collector,'post',return_value=response(uuid(2))):
            with self.assertRaisesRegex(RuntimeError,'es_scope_mismatch'):
                collector.read_category(config,{'categoryId':category_id},root_id,[requested])

    def test_selection_is_stable_rotates_brands_and_prefers_distinct_spus(self):
        cat={'name':'x','categoryId':uuid(20),'requested':3}
        def record(n, brand, spu):
            return {'productId':uuid(n), 'productInstanceId':uuid(100+n), 'spuProductId':uuid(spu), 'brand':{'name':brand}, 'isHead':True}
        records=[record(1,'a',30),record(2,'a',31),record(3,'a',32),record(4,'b',33),record(5,'b',33)]
        selected=collector.choose(cat, records)
        self.assertEqual(selected,collector.choose(cat,list(reversed(records))))
        self.assertEqual(len({r['spuProductId'] for r in selected['selected']}),3)
        self.assertEqual({r['brandName'] for r in selected['selected']},{'a','b'})
        self.assertEqual({r['selectionPass'] for r in selected['selected']},{'distinct_spu'})
        cat['requested']=5
        full=collector.choose(cat,records)
        self.assertEqual(len(full['selected']),5)
        self.assertEqual(full['selected'][-1]['selectionPass'],'repeat_spu')

    def test_summary_reconciles_missing_duplicate_and_unexpected_rows(self):
        ids=[uuid(i) for i in range(1,5)]
        response=[{'sku':ids[0],'title':'A','vendorName':'excluded','mainImages':'https://example.com/a.jpg'},
                  {'sku':ids[1],'title':'B'},{'sku':ids[1],'title':'another'},
                  {'sku':uuid(99),'title':'unexpected'}, {'sku':ids[2],'mainImages':'not-a-url'}]
        with patch.object(collector,'post',return_value=response):
            got=collector.batch_summary(ids,'secret')
        self.assertEqual([r['status'] for r in got['rows']],['ok','duplicate_in_response','ok','missing_from_response'])
        self.assertNotIn('vendorName',got['rows'][0]['data'])
        self.assertEqual(got['rows'][2]['data']['mainImages'],'')
        self.assertEqual(got['unexpectedReturnedRows'],1)

    def test_vop_eligibility_requires_confirmed_jd_and_exact_numeric_sku(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp); contract=out/'contract.json'; contract.write_text('{}')
            category_id=uuid(20)
            skus=[uuid(i) for i in range(1,6)]
            selected=[{'skuId':s,'categoryId':category_id} for s in skus]
            selection={'categories':[{'category':{'categoryId':category_id},'selected':selected}]}
            collector.save(out/'selection.json',selection)
            manifest={'selectionSha256':collector.hash_file(out/'selection.json'),'contractSha256':collector.hash_file(contract)}
            collector.save(out/'selection-manifest.json',manifest)
            summary={'selectionSha256':manifest['selectionSha256'], 'rows':[
                {'skuId':skus[0],'status':'ok','data':{'upstreamName':'本地'}},
                {'skuId':skus[1],'status':'ok','data':{'upstreamName':'京东供应链'}},
                {'skuId':skus[2],'status':'ok','data':{'upstreamName':'京东供应链'}},
                {'skuId':skus[3],'status':'missing_from_response','data':None},
                {'skuId':skus[4],'status':'ok','data':{'upstreamName':'京东供应链'}}]}
            collector.save(out/'collection'/'summary.json',summary)
            upstream=['123','456','X7','123','456']
            collector.save(out/'raw'/'es'/f'{category_id}.json',{'records':[
                {'productId':s,'product':{'upstreamSku':upstream[i]}} for i,s in enumerate(skus)]})
            requested=[]
            def fake_fetch(ids,directory,concurrency):
                requested.extend(ids)
                return ({'456':{'status':'read_failed'}},{'456'})
            with patch.object(collector,'CONTRACT',contract), patch.object(collector,'vop_cache',return_value={}), patch.object(collector,'fetch_vop',side_effect=fake_fetch), contextlib.redirect_stdout(io.StringIO()):
                collector.do_vop(out,6)
            result=collector.read_json(out/'collection'/'vop-status.json')
            self.assertEqual(requested,['456'])
            self.assertEqual(result['networkRequests'],1)
            self.assertEqual([r['requestStatus'] for r in result['rows']],['not_requested_upstream_not_confirmed','read_failed','not_requested_exact_upstream_sku_missing_or_invalid','not_requested_summary_unavailable','read_failed'])
            self.assertEqual({r['sameSkuIdentity'] for r in result['rows']},{'unverified'})

    def test_source_link_audit_rejects_lookalike_host_and_keeps_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp); contract=out/'contract.json'; contract.write_text('{}')
            collector.save(out/'selection.json',{'categories':[]})
            manifest={'selectionSha256':collector.hash_file(out/'selection.json'),'contractSha256':collector.hash_file(contract)}
            collector.save(out/'selection-manifest.json',manifest)
            audit={'recordedAt':'2026-10-30T00:00:00Z','rows':[
                {'productId':uuid(1),'category':'a','fields':{'商品名称':'paper','规格名称':'spec','货源链接':'https://item.jd.com/123.html#switch-sku'}},
                {'productId':uuid(2),'category':'b','fields':{'货源链接':'https://item.jd.com.evil.test/999.html'}},
            ]}
            collector.save(out/'ui-audit.json',audit); requested=[]
            def fake_summary(ids,key):
                return {'rows':[{'skuId':i,'status':'ok','data':{'sku':i,'upstreamName':'本地'}} for i in ids]}
            def fake_fetch(ids,directory,concurrency):
                requested.extend(ids); return ({'123':{'status':'read_failed'}},{'123'})
            with patch.object(collector,'CONTRACT',contract), patch.object(collector,'load_vars',return_value={'SANHENG_API_KEY':'test'}), patch.object(collector,'batch_summary',side_effect=fake_summary), patch.object(collector,'vop_cache',return_value={}), patch.object(collector,'fetch_vop',side_effect=fake_fetch), contextlib.redirect_stdout(io.StringIO()):
                collector.do_source_link_audit(out,6,out/'ui-audit.json')
            result=collector.read_json(out/'collection/source-link-demonstration.json')
            self.assertEqual(requested,['123'])
            self.assertEqual(result['rows'][0]['vop']['status'],'read_failed')
            self.assertEqual(result['rows'][1]['vop']['status'],'not_requested_invalid_or_non_jd_link')
            self.assertEqual({r['sameSkuIdentity'] for r in result['rows']},{'unverified'})
            self.assertEqual(result['networkRequests'],1)

    def test_existing_full_vop_receipt_is_reused_only_for_exact_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); out=root/'pilot'
            receipt={'method':'jingdong.vop.goods.getSkuDetailInfo','request':{'skuId':'123','queryExtSet':collector.VOP_QUERY_EXT},'fetchedAt':'2026-10-30T00:00:00Z','status':'ok','data':{'skuId':123,'introduce':'long original text'}}
            collector.save(out/'raw/vop/123.json',receipt)
            with patch.object(collector,'ROOT',root):
                cached=collector.vop_cache({'123','456'},out)
            self.assertEqual(set(cached),{'123'})
            self.assertEqual(cached['123']['data']['introduce'],'long original text')
            self.assertEqual(cached['123']['fetchedAt'],'2026-10-30T00:00:00Z')

    def test_sdk_worker_can_load_with_no_jobs_or_network(self):
        # Empty job list tests the embedded Bun module and SDK import without any call.
        result=subprocess.run(['bun','--no-env-file','-e',collector.VOP_CHILD_JS], input='[]',text=True,capture_output=True,timeout=15)
        self.assertEqual(result.returncode,0)
        self.assertEqual(result.stdout,'')
        self.assertEqual(result.stderr,'')


if __name__=='__main__': unittest.main()
