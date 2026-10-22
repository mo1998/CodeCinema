/**
 * Project explorer tree.
 *
 * Derived purely from the file paths that the session touched, so the tree
 * grows and shrinks as the agent works — exactly like a real IDE sidebar.
 */

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: TreeNode[];
  language?: string;
  /** True when this file was created during the recorded session. */
  created?: boolean;
}

export function buildProjectTree(
  paths: string[],
  options: {
    activePath?: string | null;
    languages?: Record<string, string>;
    createdPaths?: Set<string>;
  } = {},
): TreeNode[] {
  const { languages = {}, createdPaths } = options;
  const root: TreeNode = { name: '', path: '', type: 'folder', children: [] };

  const sorted = [...paths].sort((a, b) => {
    // Folders first, then files, alphabetically — like VS Code.
    const aDepth = a.split('/').length;
    const bDepth = b.split('/').length;
    const aIsFile = aDepth === 1;
    const bIsFile = bDepth === 1;
    if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
    return a.localeCompare(b);
  });

  for (const path of sorted) {
    const parts = path.split('/').filter(Boolean);
    let node = root;
    let prefix = '';
    parts.forEach((part, index) => {
      prefix = prefix ? `${prefix}/${part}` : part;
      const isFile = index === parts.length - 1;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: prefix,
          type: isFile ? 'file' : 'folder',
          children: [],
          language: isFile ? languages[prefix] : undefined,
          created: isFile ? createdPaths?.has(prefix) : undefined,
        };
        node.children.push(child);
      }
      node = child;
    });
  }

  return root.children;
}

/** Flatten a tree for virtualised rendering. */
export interface FlatTreeRow {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
}

export function flattenTree(
  nodes: TreeNode[],
  expanded: Set<string>,
  depth = 0,
  out: FlatTreeRow[] = [],
): FlatTreeRow[] {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.path);
    out.push({ node, depth, expanded: isExpanded, hasChildren });
    if (hasChildren && isExpanded) {
      flattenTree(node.children, expanded, depth + 1, out);
    }
  }
  return out;
}

/** Collect every folder path in the tree (so the UI can expand them all). */
export function allFolderPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        out.push(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}
