"""Index archived XLSX/CSV references losslessly; never author sources or proposals."""
import argparse
import csv
import gzip
import hashlib
import json
import os
from collections import Counter, defaultdict
from contextlib import contextmanager
from pathlib import Path
import openpyxl

DEFAULT_LIBRARY = Path(__file__).resolve().parents[1] / 'knowledge/attribute-reference-library'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def write_json(target, value):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + '.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def original_metadata(library, intake, source_id, relative):
    original = library / relative
    digest = sha(original.read_bytes())
    receipt = intake.get((source_id, relative))
    if not receipt or receipt['sha256'] != digest:
        raise ValueError(f'原文件与接收回执不一致，须登记新版本：{source_id}:{relative}')
    return {'originalFile': relative, 'originalSha256': digest}


def positions_for(headers, requested, label):
    positions = {}
    for name in requested:
        if headers.count(name) != 1:
            raise ValueError(f'{label}: 表头缺失或重复：{name}')
        positions[name] = headers.index(name)
    return positions


@contextmanager
def read_table(original, config):
    """CSV row is a logical record; line spans locate quoted multiline records."""
    file_format = config.get('format', original.suffix.lstrip('.').lower())
    header_row = config.get('headerRow', 1)
    if file_format == 'csv':
        with original.open(encoding=config.get('encoding', 'utf-8-sig'), newline='') as stream:
            reader = csv.reader(stream, delimiter=config.get('delimiter', ','), strict=True)
            headers = None
            for _ in range(header_row):
                headers = next(reader)

            def rows():
                previous_line = reader.line_num
                for row_number, values in enumerate(reader, header_row + 1):
                    origin = {'format': 'csv', 'row': row_number,
                              'physicalLineStart': previous_line + 1, 'physicalLineEnd': reader.line_num}
                    previous_line = reader.line_num
                    if values and len(values) != len(headers):
                        raise ValueError(f'{original.name}:{row_number}: CSV 列数不一致，未补齐或截断')
                    yield row_number, values, origin
            yield headers, rows()
    elif file_format == 'xlsx':
        book = openpyxl.load_workbook(original, read_only=True, data_only=False)
        try:
            sheet = book[config['sheet']]
            headers = list(next(sheet.iter_rows(min_row=header_row, max_row=header_row, values_only=True)))
            rows = ((number, list(values), {'sheet': sheet.title, 'row': number})
                    for number, values in enumerate(sheet.iter_rows(min_row=header_row + 1, values_only=True), header_row + 1))
            yield headers, rows
        finally:
            book.close()
    else:
        raise ValueError(f'Unsupported reference format: {file_format}')


def category_values(values, positions, source, label):
    category_path = [values[positions[name]] for name in source['categoryHeaders']]
    category_codes = [values[positions[name]] for name in source['categoryCodeHeaders']]
    if any(not isinstance(v, str) or not v.strip() for v in category_path):
        raise ValueError(f'{label}: 缺类目，未猜填或静默丢弃')
    return category_path, category_codes


def binding_key(category_path, category_codes, attribute):
    return tuple(category_path), tuple(category_codes), attribute


def binding_description(key):
    return {'categoryPath': list(key[0]), 'categoryCodesRaw': list(key[1]), 'attribute': key[2]}


def read_wide_view(library, source, config, metadata):
    config = {**source, **config}
    facets, categories, empty_categories = defaultdict(list), Counter(), []
    category_ids, paths, attribute_names = set(), set(), set()
    row_count, empty_rows, populated_cells, nonempty_rows = 0, 0, 0, 0
    with read_table(library / metadata['originalFile'], config) as (headers, rows):
        fixed_headers = config['categoryHeaders'] + config['categoryCodeHeaders']
        positions = positions_for(headers, headers, metadata['originalFile'])
        positions_for(headers, fixed_headers, metadata['originalFile'])
        attribute_columns = [(i, name) for i, name in enumerate(headers) if name not in fixed_headers]
        if any(not isinstance(name, str) or not name.strip() for _, name in attribute_columns):
            raise ValueError(f'{metadata["originalFile"]}: 宽表属性表头为空')
        for row_number, values, origin in rows:
            if all(value in (None, '') for value in values):
                empty_rows += 1
                continue
            category_path, category_codes = category_values(values, positions, config, f'{metadata["originalFile"]}:{row_number}')
            category_key = tuple(category_path), tuple(category_codes)
            categories[category_key] += 1
            paths.add(tuple(category_path))
            category_ids.add(tuple(category_codes))
            row_count += 1
            found = False
            for column, attribute in attribute_columns:
                if values[column] in (None, ''):
                    continue
                found = True
                attribute_names.add(attribute)
                populated_cells += 1
                locator = {**metadata, **origin, 'attributeColumn': column + 1, 'attributeHeader': attribute}
                facets[binding_key(category_path, category_codes, attribute)].append({'optionsRaw': values[column], 'origin': locator})
            if found:
                nonempty_rows += 1
            else:
                empty_categories.append({'categoryPath': category_path, 'categoryCodesRaw': category_codes, 'origin': {**metadata, **origin}})
    return facets, {
        **metadata, 'role': 'same_source_wide_view', 'format': config.get('format', 'csv'),
        'headers': headers, 'rowCount': row_count, 'columnCount': len(headers),
        'attributeColumnCount': len(attribute_columns), 'populatedAttributeNameCount': len(attribute_names),
        'categoryPathCount': len(paths), 'categoryIdCount': len(category_ids),
        'nonEmptyAttributeCellCount': populated_cells, 'nonEmptyAttributeCategoryCount': nonempty_rows,
        'emptyAttributeCategoryCount': len(empty_categories), 'emptyRowsSkipped': empty_rows,
        'duplicateCategoryKeyCount': sum(count - 1 for count in categories.values()),
    }, empty_categories


def reconcile(source, long_facets, wide_facets, wide_summary, empty_categories):
    long_only, wide_only, value_mismatches, duplicates = [], [], [], []
    matched = 0
    for key in sorted(long_facets.keys() | wide_facets.keys()):
        long_values, wide_values = long_facets.get(key, []), wide_facets.get(key, [])
        long_counts = Counter(item['optionsRaw'] for item in long_values)
        wide_counts = Counter(item['optionsRaw'] for item in wide_values)
        matched += sum((long_counts & wide_counts).values())
        description = binding_description(key)
        if not wide_values:
            long_only.append({**description, 'long': long_values})
        elif not long_values:
            wide_only.append({**description, 'wide': wide_values})
        elif long_counts != wide_counts:
            value_mismatches.append({**description, 'long': long_values, 'wide': wide_values})
        if len(long_values) > 1 or len(wide_values) > 1:
            duplicates.append({**description, 'long': long_values, 'wide': wide_values})
    summary = {
        'status': 'exact_nonempty_facets_match' if not (long_only or wide_only or value_mismatches) else 'differences_preserved_for_review',
        'longBindingCount': sum(map(len, long_facets.values())),
        'wideNonEmptyBindingCount': sum(map(len, wide_facets.values())),
        'matchedBindingCount': matched, 'longOnlyBindingCount': len(long_only),
        'wideOnlyBindingCount': len(wide_only), 'valueMismatchBindingCount': len(value_mismatches),
        'duplicateBindingKeyCount': len(duplicates),
        'wideCategoryCount': wide_summary['rowCount'],
        'wideEmptyAttributeCategoryCount': len(empty_categories),
        'additionalIndexedRowsFromWide': 0, 'additionalIndependentEvidenceFromWide': 0,
    }
    report = {
        'sourceId': source['id'], 'sourceFamilyId': source.get('sourceFamilyId', source['id']),
        'comparison': 'exact category path + raw category codes + attribute name + raw option string; no unit conversion, trimming or option splitting',
        'coverageMeaning': 'Empty wide categories mean no facets supplied in this file; not absence of applicable target attributes.',
        'summary': summary, 'longOnlyBindings': long_only, 'wideOnlyBindings': wide_only,
        'valueMismatches': value_mismatches, 'duplicateBindings': duplicates,
        'emptyAttributeCategories': empty_categories,
    }
    return report


def index_source(library, source, intake):
    source_id = source['id']
    metadata = original_metadata(library, intake, source_id, source['originalFile'])
    original_hash = metadata['originalSha256']
    wide_facets, wide_summary, empty_categories = {}, None, []
    supporting = source.get('supportingFiles', [])
    if len(supporting) > 1:
        raise ValueError(f'{source_id}: 目前仅支持一个同源宽表核对文件')
    if supporting:
        if supporting[0]['role'] != 'same_source_wide_view':
            raise ValueError(f'{source_id}: 未支持的辅助文件用途')
        support_metadata = original_metadata(library, intake, source_id, supporting[0]['originalFile'])
        wide_facets, wide_summary, empty_categories = read_wide_view(library, source, supporting[0], support_metadata)
    target = library / source['indexFile']
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + '.tmp')
    count, empty_rows, formula_cells = 0, 0, 0
    paths, category_ids, ids, attribute_names, long_facets = set(), set(), Counter(), set(), defaultdict(list)
    try:
        with read_table(library / source['originalFile'], source) as (headers, rows):
            requested = source['categoryHeaders'] + source['categoryCodeHeaders'] + [source['attributeHeader']] + list(source['fieldHeaders'].values())
            positions = positions_for(headers, requested, source_id)
            with temporary.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as output:
                for row_number, values, origin in rows:
                    if all(value in (None, '') for value in values):
                        empty_rows += 1
                        continue
                    get = lambda name: values[positions[name]]
                    attribute = get(source['attributeHeader'])
                    category_path, category_codes = category_values(values, positions, source, f'{source_id}:{row_number}')
                    if not isinstance(attribute, str) or not attribute.strip():
                        raise ValueError(f'{source_id}:{row_number}: 缺属性，未猜填或静默丢弃')
                    fields = {key: get(name) for key, name in source['fieldHeaders'].items()}
                    if origin.get('format') == 'csv':
                        origin.update({'attributeColumn': positions[source['attributeHeader']] + 1, 'attributeHeader': source['attributeHeader']})
                    else:
                        origin['attributeCell'] = f'{openpyxl.utils.get_column_letter(positions[source["attributeHeader"]] + 1)}{row_number}'
                    record = {
                        'id': f'{source_id}:{original_hash[:16]}:{origin.get("sheet", "csv")}:{row_number}',
                        'sourceId': source_id, 'sourceKind': source['sourceKind'],
                        'sourceFamilyId': source.get('sourceFamilyId', source_id),
                        'categoryPath': category_path, 'categoryCodesRaw': category_codes,
                        'attribute': attribute, 'fields': fields, 'origin': origin, 'rawValues': list(values),
                    }
                    if source.get('referenceRole'):
                        record['referenceRole'] = source['referenceRole']
                    if source.get('categoryIdHeader'):
                        record['categoryIdRaw'] = get(source['categoryIdHeader'])
                    if supporting:
                        key = binding_key(category_path, category_codes, attribute)
                        long_facets[key].append({'recordId': record['id'], 'optionsRaw': fields.get('optionsRaw'), 'origin': {**metadata, **origin}})
                        record['supportingOrigins'] = [entry['origin'] for entry in wide_facets.get(key, []) if entry['optionsRaw'] == fields.get('optionsRaw')]
                    output.write((encode(record) + '\n').encode('utf-8'))
                    count += 1
                    paths.add(tuple(category_path))
                    category_ids.add(tuple(category_codes))
                    ids[fields.get('templateIdRaw')] += 1
                    attribute_names.add(attribute)
                    formula_cells += sum(isinstance(v, str) and v.startswith('=') for v in values)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    summary = {
        'sourceId': source_id, 'sourceKind': source['sourceKind'],
        'sourceFamilyId': source.get('sourceFamilyId', source_id),
        'format': source.get('format', Path(source['originalFile']).suffix.lstrip('.').lower()),
        **metadata, 'indexFile': source['indexFile'], 'indexSha256': sha(target.read_bytes()),
        'headers': headers, 'rowCount': count, 'categoryPathCount': len(paths),
        'categoryIdCount': len(category_ids) if source['categoryCodeHeaders'] else 0,
        'distinctAttributeNames': len(attribute_names),
        'templateIdCount': len([key for key in ids if key is not None]),
        'emptyRowsSkipped': empty_rows, 'formulaCellsPreserved': formula_cells,
        'rowIdentity': 'source version + sheet or CSV logical record; no merging by templateId or name',
    }
    if source.get('sheet'):
        summary['indexedSheet'] = source['sheet']
    if wide_summary:
        summary['supportingFiles'] = [wide_summary]
        report = reconcile(source, long_facets, wide_facets, wide_summary, empty_categories)
        report_file = source['reconciliationFile']
        write_json(library / report_file, report)
        summary['reconciliation'] = {**report['summary'], 'reportFile': report_file, 'reportSha256': sha((library / report_file).read_bytes())}
    return summary


def index_library(library):
    catalog_file = library / 'catalog.json'
    catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
    receipts = json.loads((library / 'intake-receipt.json').read_text(encoding='utf-8'))['sources']
    intake = {(receipt['sourceId'], receipt['originalFile']): receipt for receipt in receipts}
    if len(intake) != len(receipts):
        raise ValueError('重复的原件接收回执')
    summaries = [index_source(library, source, intake) for source in catalog['sources'] if source['access'] == 'local_template_index']
    manifest = {'version': 2, 'catalogSha256': sha(catalog_file.read_bytes()), 'importerSha256': sha(Path(__file__).read_bytes()),
                'usage': 'candidate_reference_only', 'sourceInstructionsExecutable': False, 'sources': summaries}
    write_json(library / 'indexes/manifest.json', manifest)
    return {'sources': [{'id': item['sourceId'], 'rows': item['rowCount'], 'categoryPaths': item['categoryPathCount']} for item in summaries],
            'totalRows': sum(item['rowCount'] for item in summaries), 'sourceEdits': 0, 'workbookEdits': 0, 'proposalEdits': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', type=Path, default=DEFAULT_LIBRARY)
    args = parser.parse_args()
    print(json.dumps(index_library(args.library.resolve()), ensure_ascii=False))
