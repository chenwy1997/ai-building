import { shortCategoryId, slugify } from "./util.ts";
import type { CategoryNode, CategoryTreeDocument, ContextChunk, StdTextOptions } from "./types.ts";

function line(node: CategoryNode, options: StdTextOptions): string {
  const prefix = "  ".repeat(Math.max(0, node.level - 1));
  const id = options.includeIds === false ? "" : `|i=${shortCategoryId(node.id)}`;
  const leaf = node.isLeaf ? "*" : "+";
  const enabled = node.enabled ? "" : "!";
  return `${prefix}${node.level}${leaf}${enabled} ${node.name}${id}`;
}

/**
 * 将类目树压成可复用的标准文本：缩进表达父子关系，父路径不重复书写，短哈希用于回填真实 ID。
 */
export function toStdText(
  document: CategoryTreeDocument,
  options: StdTextOptions = {},
): string {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const nodes = document.nodes.filter((node) => node.level <= maxDepth);
  const header = [
    `#STD-CAT|v=${document.version}|n=${nodes.length}|leaf=${document.leafCount}`,
    `#FORMAT|level+=branch|level*=leaf|!=disabled|indent=2 spaces|i=short-id`,
  ];
  return `${[...header, ...nodes.map((node) => line(node, options))].join("\n")}\n`;
}

export function makeContextChunks(
  document: CategoryTreeDocument,
  groupDepth = 1,
  options: Omit<StdTextOptions, "groupDepth"> = {},
): ContextChunk[] {
  const depth = Math.max(1, Math.floor(groupDepth));
  const anchors = document.nodes.filter((node) => node.level === depth);
  const fallbackAnchors = anchors.length > 0
    ? anchors
    : document.nodes.filter((node) => node.level === Math.max(...document.nodes.map((node) => node.level)));
  const groups = new Map<string, CategoryNode[]>();
  for (const anchor of fallbackAnchors) {
    const values = document.nodes.filter((node) =>
      node.pathIds.includes(anchor.id) || anchor.pathIds.includes(node.id),
    );
    groups.set(anchor.id, values);
  }
  return [...groups.entries()].map(([rootId, nodes]) => {
    const root = document.nodes.find((node) => node.id === rootId)!;
    const local: CategoryTreeDocument = {
      ...document,
      nodes,
      roots: [rootId],
      leafCount: nodes.filter((node) => node.isLeaf).length,
    };
    return {
      key: `d${depth}-${slugify(root.pathNames.join("-"))}-id-${shortCategoryId(rootId)}`,
      groupDepth: depth,
      rootId,
      rootPath: root.pathNames,
      nodeCount: nodes.length,
      leafCount: local.leafCount,
      text: `#PATH|${JSON.stringify(root.pathNames)}\n${toStdText(local, options)}`,
    };
  });
}
