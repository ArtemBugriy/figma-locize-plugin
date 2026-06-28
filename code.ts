// Locize integration plugin main code

interface Settings {
  projectId: string;
  apiKey: string;
  version: string;
  baseLanguage: string;
}

interface ScanItem {
  nodeId: string;
  name: string;
  originalName: string;
  text: string;
  key: string;
  namespace: string;
  localKey: string;
  existing: boolean;
  selected?: boolean;
}

interface TranslationMap { [key: string]: string; }

const PLUGIN_KEY_KEY = 'locize:key';
const PLUGIN_ORIG_NAME_KEY = 'locize:origName';
const SELECTION_STORAGE_KEY = 'locize:selected';
const DEFAULT_NS = 'UnknownFeatureNs';
const MAX_SCAN_NODES = 250;

// --- Storage helpers ---

async function getSelectionMap(): Promise<Record<string, boolean>> {
  const v = await figma.clientStorage.getAsync(SELECTION_STORAGE_KEY);
  const map = (v as Record<string, boolean>) || {};
  // Compact: keep only unchecked entries (false). Remove truthy leftovers from older versions.
  let mutated = false;
  for (const k of Object.keys(map)) {
    if (map[k] !== false) { delete map[k]; mutated = true; }
  }
  if (mutated) await figma.clientStorage.setAsync(SELECTION_STORAGE_KEY, map);
  return map;
}

async function setSelection(nodeId: string, selected: boolean): Promise<void> {
  const map = await getSelectionMap();
  if (selected === false) {
    map[nodeId] = false;
  } else {
    delete map[nodeId];
  }
  await figma.clientStorage.setAsync(SELECTION_STORAGE_KEY, map);
}

async function setSelectionBulk(list: { nodeId: string; selected: boolean }[]): Promise<void> {
  if (!list.length) return;
  const map = await getSelectionMap();
  let mutated = false;
  for (const { nodeId, selected } of list) {
    if (selected === false) {
      if (map[nodeId] !== false) { map[nodeId] = false; mutated = true; }
    } else if (nodeId in map) {
      delete map[nodeId]; mutated = true;
    }
  }
  if (mutated) await figma.clientStorage.setAsync(SELECTION_STORAGE_KEY, map);
}

// --- Key / node helpers ---

/** Split a full i18n key into namespace and localKey on the first dot. */
function parseKey(fullKey: string): { namespace: string; localKey: string } {
  const dot = fullKey.indexOf('.');
  return dot > -1
    ? { namespace: fullKey.slice(0, dot), localKey: fullKey.slice(dot + 1) }
    : { namespace: '', localKey: fullKey };
}

/** Returns the current selection, or the entire page when nothing is selected. */
function getSourceNodes(): readonly SceneNode[] {
  return figma.currentPage.selection.length
    ? figma.currentPage.selection
    : figma.currentPage.children;
}

function collectTextNodes(nodes: readonly SceneNode[], limit = Infinity, ignoreHidden = false): { nodes: TextNode[]; truncated: boolean } {
  const result: TextNode[] = [];
  const stack: SceneNode[] = [...nodes];
  let visited = 0;
  while (stack.length) {
    if (visited >= limit) return { nodes: result, truncated: true };
    const node = stack.pop()!;
    if (ignoreHidden && !node.visible) continue;
    visited++;
    if (node.type === 'TEXT') {
      result.push(node as TextNode);
    } else if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) {
        stack.push(child as SceneNode);
      }
    }
  }
  return { nodes: result, truncated: false };
}

function generateKeys(textNodes: TextNode[], namespace: string, mergeSameName = false): ScanItem[] {
  const used = new Set<string>();
  const items: ScanItem[] = [];
  for (const node of textNodes) {
    const existingKey = node.getPluginData(PLUGIN_KEY_KEY);
    const storedOriginal = node.getPluginData(PLUGIN_ORIG_NAME_KEY);
    let key: string;
    if (existingKey) {
      key = existingKey;
      used.add(parseKey(existingKey).localKey);
    } else {
      const candidate = node.name.trim() || 'text';
      let finalKey = candidate;
      if (!mergeSameName) {
        let i = 1;
        while (used.has(finalKey)) { i += 1; finalKey = `${candidate}_${i}`; }
      }
      key = `${namespace}.${finalKey}`;
      used.add(finalKey);
    }
    const { namespace: ns, localKey } = parseKey(key);
    items.push({
      nodeId: node.id,
      name: node.name,
      originalName: storedOriginal || node.name,
      text: node.characters,
      key,
      namespace: ns,
      localKey,
      existing: !!existingKey,
    });
  }
  return items;
}

function fontKey(font: FontName): string {
  return `${font.family}__${font.style}`;
}

function collectNodeFonts(node: TextNode): FontName[] {
  if (node.fontName !== figma.mixed) return [node.fontName as FontName];
  return node.getStyledTextSegments(['fontName']).map(s => s.fontName);
}

/** Load all fonts for the given nodes. Returns a set of font keys that failed to load. */
async function ensureFonts(nodes: TextNode[]): Promise<Set<string>> {
  const toLoad = new Map<string, FontName>();
  for (const n of nodes) {
    for (const font of collectNodeFonts(n)) {
      const k = fontKey(font);
      if (!toLoad.has(k)) toLoad.set(k, font);
    }
  }
  const failed = new Set<string>();
  await Promise.all(
    Array.from(toLoad.entries()).map(async ([k, font]) => {
      try { await figma.loadFontAsync(font); }
      catch (_) { failed.add(k); }
    })
  );
  return failed;
}

/** Returns true if all fonts for this node loaded successfully. */
function nodeFontsReady(node: TextNode, failed: Set<string>): boolean {
  return collectNodeFonts(node).every(f => !failed.has(fontKey(f)));
}

function collectAssignedNamespaces(): string[] {
  const set = new Set<string>();
  const { nodes } = collectTextNodes(getSourceNodes(), MAX_SCAN_NODES);
  for (const n of nodes) {
    const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
    if (fullKey) {
      const { namespace } = parseKey(fullKey);
      if (namespace) set.add(namespace);
    }
  }
  return Array.from(set).sort();
}

async function applyTranslations(map: TranslationMap, namespace: string, nodeIds?: string[]) {
  const { nodes: allNodes } = collectTextNodes(getSourceNodes());
  const idFilter = nodeIds && nodeIds.length ? new Set(nodeIds) : null;
  const targetNodes = allNodes
    .filter(n => n.getPluginData(PLUGIN_KEY_KEY))
    .filter(n => !idFilter || idFilter.has(n.id));
  const failedFonts = await ensureFonts(targetNodes);
  let skipped = 0;
  for (const n of targetNodes) {
    if (!nodeFontsReady(n, failedFonts)) { skipped++; continue; }
    const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
    if (!fullKey) continue;
    if (map[fullKey] !== undefined) { n.characters = map[fullKey]; continue; }
    if (namespace && fullKey.startsWith(namespace + '.')) {
      const shortKey = fullKey.slice(namespace.length + 1);
      if (map[shortKey] !== undefined) n.characters = map[shortKey];
    }
  }
  if (skipped > 0) figma.notify(`Skipped ${skipped} node(s): font not available`, { error: true });
}

/** Build a ScanItem list for all text nodes with an assigned key in the current scope. */
async function buildAssignedItems(namespace?: string): Promise<{ items: ScanItem[]; truncated: boolean }> {
  const { nodes: textNodes, truncated } = collectTextNodes(getSourceNodes(), MAX_SCAN_NODES);
  const selMap = await getSelectionMap();
  const items = textNodes
    .filter(n => n.getPluginData(PLUGIN_KEY_KEY))
    .map(n => {
      const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
      const { namespace: ns, localKey } = parseKey(fullKey);
      return {
        nodeId: n.id,
        name: n.name,
        originalName: n.getPluginData(PLUGIN_ORIG_NAME_KEY) || n.name,
        text: n.characters,
        key: fullKey,
        namespace: ns,
        localKey,
        existing: true,
        selected: selMap[n.id] !== false,
      };
    })
    .filter(i => !namespace || i.key.startsWith(namespace + '.'));
  return { items, truncated };
}

// --- Plugin init ---

const DEFAULT_UI_WIDTH = 740;
const DEFAULT_UI_HEIGHT = 740;

(async () => {
  const [w, h] = await Promise.all([
    figma.clientStorage.getAsync('ui.width'),
    figma.clientStorage.getAsync('ui.height'),
  ]);
  figma.showUI(__html__, {
    width:  Number(w) || DEFAULT_UI_WIDTH,
    height: Number(h) || DEFAULT_UI_HEIGHT,
  });
})();

let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null;

figma.on('selectionchange', () => {
  if (selectionChangeTimer !== null) clearTimeout(selectionChangeTimer);
  selectionChangeTimer = setTimeout(() => {
    selectionChangeTimer = null;
    const selectionLength = figma.currentPage.selection.length;
    figma.ui.postMessage({
      type: 'selection-change',
      selectionLength,
      namespaces: selectionLength > 0 ? collectAssignedNamespaces() : [],
    });
  }, 150);
});

// --- Message handler ---

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'load-settings': {
      const [projectId, apiKey, version, baseLanguage] = await Promise.all([
        figma.clientStorage.getAsync('locize.projectId'),
        figma.clientStorage.getAsync('locize.apiKey'),
        figma.clientStorage.getAsync('locize.version'),
        figma.clientStorage.getAsync('locize.baseLanguage'),
      ]);
      const settings: Settings = {
        projectId: String(projectId || ''),
        apiKey: String(apiKey || ''),
        version: String(version || 'latest'),
        baseLanguage: String(baseLanguage || 'en'),
      };
      figma.ui.postMessage({ type: 'settings-loaded', settings });
      break;
    }
    case 'save-settings': {
      const s: Settings = msg.settings;
      await Promise.all([
        figma.clientStorage.setAsync('locize.projectId', s.projectId),
        figma.clientStorage.setAsync('locize.apiKey', s.apiKey),
        figma.clientStorage.setAsync('locize.version', s.version),
        figma.clientStorage.setAsync('locize.baseLanguage', s.baseLanguage),
      ]);
      figma.notify('Settings saved');
      break;
    }
    case 'scan-selection': {
      const namespace: string = msg.namespace || DEFAULT_NS;
      const selection = figma.currentPage.selection;
      if (!selection.length) {
        figma.ui.postMessage({ type: 'scan-result', items: [], warning: 'No selection' });
        break;
      }
      const { nodes: textNodes, truncated } = collectTextNodes(selection as readonly SceneNode[], MAX_SCAN_NODES, !!msg.ignoreHidden);
      if (!textNodes.length) {
        figma.ui.postMessage({ type: 'scan-result', items: [], warning: 'No text nodes found' });
        break;
      }
      const items = generateKeys(textNodes, namespace, !!msg.mergeSameName);
      try {
        const selMap = await getSelectionMap();
        for (const it of items) it.selected = selMap[it.nodeId] !== false;
      } catch (_) { /* clientStorage unavailable, default to all selected */ }
      figma.ui.postMessage({ type: 'scan-result', items, truncated, nodeLimit: MAX_SCAN_NODES });
      break;
    }
    case 'apply-keys': {
      const items: ScanItem[] = msg.items;
      await Promise.all(items.map(async (item) => {
        const node = await figma.getNodeByIdAsync(item.nodeId);
        if (node && node.type === 'TEXT') {
          const textNode = node as TextNode;
          textNode.setPluginData(PLUGIN_KEY_KEY, item.key);
          if (!textNode.getPluginData(PLUGIN_ORIG_NAME_KEY)) {
            textNode.setPluginData(PLUGIN_ORIG_NAME_KEY, item.originalName || textNode.name);
          }
          // Layer name is intentionally left untouched — keep the hand-written name.
          // The namespace/key live in plugin data only, and are shown in the table.
        }
      }));
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
      figma.notify('Keys applied');
      break;
    }
    case 'apply-language': {
      await applyTranslations(msg.map as TranslationMap, msg.namespace as string, msg.nodeIds as string[] | undefined);
      figma.notify('Language applied');
      break;
    }
    case 'get-translatable': {
      // Same selection-scoped, keyed-only data as get-assigned, but a separate
      // result type so the Translation tab never clobbers the Key tab's table.
      const { items, truncated } = await buildAssignedItems();
      figma.ui.postMessage({ type: 'translatable-result', items, truncated, nodeLimit: MAX_SCAN_NODES });
      const namespaces = Array.from(new Set(items.map(i => i.namespace).filter(Boolean))).sort() as string[];
      figma.ui.postMessage({ type: 'namespaces-result', namespaces });
      break;
    }
    case 'get-assigned': {
      const namespace = msg.namespace || '';
      const { items, truncated } = await buildAssignedItems(namespace);
      figma.ui.postMessage({ type: 'assigned-result', items, truncated, nodeLimit: MAX_SCAN_NODES });
      // Derive namespaces from already-traversed items when no filter is active,
      // avoiding a second full tree walk via collectAssignedNamespaces().
      const namespaces = namespace
        ? collectAssignedNamespaces()
        : Array.from(new Set(items.map(i => i.namespace).filter(Boolean))).sort() as string[];
      figma.ui.postMessage({ type: 'namespaces-result', namespaces });
      break;
    }
    case 'restore-names': {
      const nodeIds: { nodeId: string }[] = msg.items || [];
      await Promise.all(nodeIds.map(async ({ nodeId }) => {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (node && node.type === 'TEXT') {
          const textNode = node as TextNode;
          const orig = textNode.getPluginData(PLUGIN_ORIG_NAME_KEY);
          if (orig) {
            try { textNode.name = orig; } catch (e) { console.error(e); }
          }
        }
      }));
      figma.notify('Names restored');
      const { items, truncated } = await buildAssignedItems();
      figma.ui.postMessage({ type: 'assigned-result', items, truncated, nodeLimit: MAX_SCAN_NODES });
      const namespaces = Array.from(new Set(items.map(i => i.namespace).filter(Boolean))).sort() as string[];
      figma.ui.postMessage({ type: 'namespaces-result', namespaces });
      break;
    }
    case 'get-namespaces': {
      const namespaces = figma.currentPage.selection.length > 0 ? collectAssignedNamespaces() : [];
      figma.ui.postMessage({ type: 'namespaces-result', namespaces });
      break;
    }
    case 'set-selected': {
      await setSelection(msg.nodeId as string, !!msg.selected);
      break;
    }
    case 'set-selected-bulk': {
      const list: { nodeId: string; selected: boolean }[] = Array.isArray(msg.list) ? msg.list : [];
      await setSelectionBulk(list);
      break;
    }
    case 'resize': {
      const w = Math.round(msg.width as number);
      const h = Math.round(msg.height as number);
      figma.ui.resize(w, h);
      await Promise.all([
        figma.clientStorage.setAsync('ui.width', w),
        figma.clientStorage.setAsync('ui.height', h),
      ]);
      break;
    }
    case 'notify': {
      const text = (msg as { message?: string }).message || '';
      if (text) figma.notify(text);
      break;
    }
    case 'close': {
      figma.closePlugin();
      break;
    }
    case 'update-text': {
      const nodeId = msg.nodeId as string;
      const text = String(msg.text ?? '');
      try {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (node && node.type === 'TEXT') {
          const tn = node as TextNode;
          const failedFonts = await ensureFonts([tn]);
          if (nodeFontsReady(tn, failedFonts)) {
            tn.characters = text;
          } else {
            figma.notify('One of the node fonts is not available — install it locally and reload the plugin', { error: true });
          }
        }
      } catch (e) { console.error('update-text failed', e); }
      break;
    }
  }
};
