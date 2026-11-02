import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('counter',Path(__file__).resolve().parents[1]/'scripts/count-sku-scope.py')
counter=importlib.util.module_from_spec(spec);spec.loader.exec_module(counter)

class ScopeCountTests(unittest.TestCase):
    def test_separates_new_categories_remaining_old_categories_and_parent_mounts(self):
        nodes={k:{'path':'清洁用品>'+k,'isLeaf':k!='root','enabled':True} for k in ['a','b','c','root']}
        contract={'proposals':[{'categoryId':'a'},{'categoryId':'b'},{'categoryId':'b'},{'categoryId':'c'}]}
        selection={'categories':[{'category':{'categoryId':'a'}}]}
        prior={'skus':[{'skuId':'1'},{'skuId':'5'}]}
        records=[{'productId':sku,'spuProductId':spu,'categoryId':cat,'categoryName':cat} for sku,spu,cat in
                 [('1','s1','a'),('2','s2','a'),('3','s3','b'),('3','s3','b'),('4','s4','root')]]
        r=counter.summarize(records,nodes,contract,selection,prior)
        self.assertEqual(r['allRoot'],{'documents':5,'skus':4,'spus':4})
        self.assertEqual(r['otherCategoriesRemaining'],{'documents':2,'skus':1,'spus':1})
        self.assertEqual(r['previousCategoriesRemaining']['skus'],1)
        self.assertEqual(r['outsideAttributeContract']['skus'],1)
        self.assertEqual(r['governedCategoryCount'],3)
        self.assertEqual(r['otherCategoryCount'],2)
        self.assertEqual(r['otherCategoriesWithRemainingSkus'],1)
        self.assertEqual(r['otherAttributePositions'],2)
        self.assertEqual(r['priorSampleOutsideCurrentRoot'],['5'])
        self.assertEqual(len(r['duplicateSkuDocumentGroups']),1)

if __name__=='__main__':unittest.main()
