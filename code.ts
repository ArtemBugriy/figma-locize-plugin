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

function collectTextNodes(nodes: readonly SceneNode[]): TextNode[] {
  const result: TextNode[] = [];
  function traverse(node: SceneNode) {
    if (node.type === 'TEXT') {
      result.push(node as TextNode);
    } else if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) traverse(child as SceneNode);
    }
  }
  nodes.forEach(traverse);
  return result;
}

function generateKeys(textNodes: TextNode[], namespace: string): ScanItem[] {
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
      let i = 1;
      while (used.has(finalKey)) { i += 1; finalKey = `${candidate}_${i}`; }
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

async function ensureFonts(nodes: TextNode[]) {
  const loaded = new Set<string>();
  const promises: Promise<void>[] = [];
  for (const n of nodes) {
    if (n.fontName === figma.mixed) continue;
    const font = n.fontName as FontName;
    const k = `${font.family}__${font.style}`;
    if (!loaded.has(k)) { loaded.add(k); promises.push(figma.loadFontAsync(font)); }
  }
  await Promise.all(promises);
}

function collectAssignedNamespaces(): string[] {
  const set = new Set<string>();
  for (const n of collectTextNodes(getSourceNodes())) {
    const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
    if (fullKey) {
      const { namespace } = parseKey(fullKey);
      if (namespace) set.add(namespace);
    }
  }
  return Array.from(set).sort();
}

async function applyTranslations(map: TranslationMap, namespace: string) {
  const targetNodes = collectTextNodes(getSourceNodes()).filter(n => n.getPluginData(PLUGIN_KEY_KEY));
  await ensureFonts(targetNodes);
  for (const n of targetNodes) {
    const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
    if (!fullKey) continue;
    if (map[fullKey] !== undefined) { n.characters = map[fullKey]; continue; }
    if (namespace && fullKey.startsWith(namespace + '.')) {
      const shortKey = fullKey.slice(namespace.length + 1);
      if (map[shortKey] !== undefined) n.characters = map[shortKey];
    }
  }
}

/** Build a ScanItem list for all text nodes with an assigned key in the current scope. */
async function buildAssignedItems(namespace?: string): Promise<ScanItem[]> {
  const textNodes = collectTextNodes(getSourceNodes());
  const selMap = await getSelectionMap();
  return textNodes
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
}

// --- Plugin init ---

figma.showUI(__html__, { width: 740, height: 740 });

figma.on('selectionchange', () => {
  figma.ui.postMessage({
    type: 'selection-change',
    selectionLength: figma.currentPage.selection.length,
    namespaces: collectAssignedNamespaces(),
  });
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
      const textNodes = collectTextNodes(selection as readonly SceneNode[]);
      if (!textNodes.length) {
        figma.ui.postMessage({ type: 'scan-result', items: [], warning: 'No text nodes found' });
        break;
      }
      const items = generateKeys(textNodes, namespace);
      try {
        const selMap = await getSelectionMap();
        for (const it of items) it.selected = selMap[it.nodeId] !== false;
      } catch (_) { /* clientStorage unavailable, default to all selected */ }
      figma.ui.postMessage({ type: 'scan-result', items });
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
          try { textNode.name = item.key; } catch (e) { console.error(e); }
        }
      }));
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
      figma.notify('Keys applied and names updated');
      break;
    }
    case 'apply-language': {
      await applyTranslations(msg.map as TranslationMap, msg.namespace as string);
      figma.notify('Language applied');
      break;
    }
    case 'get-assigned': {
      const items = await buildAssignedItems(msg.namespace || '');
      figma.ui.postMessage({ type: 'assigned-result', items });
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
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
      const items = await buildAssignedItems();
      figma.ui.postMessage({ type: 'assigned-result', items });
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
      break;
    }
    case 'get-namespaces': {
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
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
          await ensureFonts([tn]);
          tn.characters = text;
        }
      } catch (e) { console.error('update-text failed', e); }
      break;
    }
  }
};
