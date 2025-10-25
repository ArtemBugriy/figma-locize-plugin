// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// Locize integration plugin main code

interface Settings {
  projectId: string;
  apiKey: string; // write key
  version: string; // e.g. 'latest' or environment version
  baseLanguage: string;
}

interface ScanItem {
  nodeId: string;
  name: string;
  originalName: string;
  text: string;
  key: string; // full key namespace.local
  namespace: string; // namespace
  localKey: string; // key part without namespace
  existing: boolean;
  selected?: boolean; // persisted UI selection state
}

interface TranslationMap { [key: string]: string; }

const PLUGIN_KEY_KEY = 'locize:key';
const PLUGIN_ORIG_NAME_KEY = 'locize:origName';
const SELECTION_STORAGE_KEY = 'locize:selected';

// Helpers to persist selection state
async function getSelectionMap(): Promise<Record<string, boolean>> {
  const v = await figma.clientStorage.getAsync(SELECTION_STORAGE_KEY);
  const map = (v as Record<string, boolean>) || {};
  // Compact the map: keep only unchecked entries (false). Remove any truthy leftovers from previous versions.
  let mutated = false;
  for (const k of Object.keys(map)) {
    if (map[k] !== false) {
      delete map[k];
      mutated = true;
    }
  }
  if (mutated) {
    await figma.clientStorage.setAsync(SELECTION_STORAGE_KEY, map);
  }
  return map;
}

async function setSelection(nodeId: string, selected: boolean): Promise<void> {
  const map = await getSelectionMap();
  if (selected === false) {
    // Persist only unchecked items to minimize storage
    map[nodeId] = false;
  } else {
    // Remove entry when item is (re)selected to use default-checked behavior
    if (nodeId in map) delete map[nodeId];
  }
  await figma.clientStorage.setAsync(SELECTION_STORAGE_KEY, map);
}

async function setSelectionBulk(list: { nodeId: string; selected: boolean }[]): Promise<void> {
  if (!Array.isArray(list) || !list.length) return;
  const map = await getSelectionMap();
  let mutated = false;
  for (const it of list) {
    if (it.selected === false) {
      if (map[it.nodeId] !== false) {
        map[it.nodeId] = false;
        mutated = true;
      }
    } else {
      if (it.nodeId in map) {
        delete map[it.nodeId];
        mutated = true;
      }
    }
  }
  if (mutated) {
    await figma.clientStorage.setAsync(SELECTION_STORAGE_KEY, map);
  }
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9\s-_]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function collectTextNodes(nodes: readonly SceneNode[]): TextNode[] {
  const result: TextNode[] = [];
  function traverse(node: SceneNode) {
    if ('type' in node) {
      if (node.type === 'TEXT') {
        result.push(node as TextNode);
      } else if ('children' in node) {
        for (const child of (node as ChildrenMixin).children) traverse(child as SceneNode);
      }
    }
  }
  nodes.forEach(n => traverse(n));
  return result;
}

function buildHierarchyPath(node: SceneNode): string[] {
  const path: string[] = [];
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE') {
    if ('name' in current) path.unshift(current.name);
    current = current.parent as BaseNode | null;
  }
  return path;
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
      used.add(key.split('.').slice(-1)[0]);
    } else {
      const pathParts = buildHierarchyPath(node).slice(-3);
      const baseName = node.name && !/^text/i.test(node.name) ? node.name : node.characters.slice(0, 30);
      const raw = [...pathParts, baseName].join('_');
      let candidate = slugify(raw);
      if (!candidate) candidate = 'text';
      let finalKey = candidate;
      let i = 1;
      while (used.has(finalKey)) {
        i += 1;
        finalKey = `${candidate}_${i}`;
      }
      key = `${namespace}.${finalKey}`;
      used.add(finalKey);
    }
    const dotIndex = key.indexOf('.');
    const ns = dotIndex > -1 ? key.slice(0, dotIndex) : '';
    const local = dotIndex > -1 ? key.slice(dotIndex + 1) : key;
    items.push({
      nodeId: node.id,
      name: node.name,
      originalName: storedOriginal || node.name,
      text: node.characters,
      key,
      namespace: ns,
      localKey: local,
      existing: !!existingKey,
    });
  }
  return items;
}

async function ensureFonts(nodes: TextNode[]) {
  const promises: Promise<void>[] = [];
  const loaded = new Set<string>();
  for (const n of nodes) {
    const fontName = n.fontName;
    if (fontName === figma.mixed) continue;
    const key = `${(fontName as FontName).family}__${(fontName as FontName).style}`;
    if (!loaded.has(key)) {
      loaded.add(key);
      promises.push(figma.loadFontAsync(fontName as FontName));
    }
  }
  await Promise.all(promises);
}

function collectAssignedNamespaces(): string[] {
  const set = new Set<string>();
  const sourceNodes: readonly SceneNode[] = figma.currentPage.selection.length ? figma.currentPage.selection : figma.currentPage.children;
  const textNodes = collectTextNodes(sourceNodes);
  for (const n of textNodes) {
    const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
    if (fullKey) {
      const dot = fullKey.indexOf('.');
      if (dot > -1) set.add(fullKey.slice(0, dot));
    }
  }
  return Array.from(set).sort();
}

async function applyTranslations(map: TranslationMap, namespace: string) {
  const sourceNodes: readonly SceneNode[] = figma.currentPage.selection.length ? figma.currentPage.selection : figma.currentPage.children;
  const allNodes: TextNode[] = collectTextNodes(sourceNodes);
  const targetNodes = allNodes.filter(n => n.getPluginData(PLUGIN_KEY_KEY));
  await ensureFonts(targetNodes);
  for (const n of targetNodes) {
    const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
    if (!fullKey) continue;
    if (map[fullKey] !== undefined) {
      n.characters = map[fullKey];
      continue;
    }
    if (namespace && fullKey.startsWith(namespace + '.')) {
      const shortKey = fullKey.replace(namespace + '.', '');
      if (map[shortKey] !== undefined) {
        n.characters = map[shortKey];
      }
    }
  }
}

figma.showUI(__html__, { width: 620, height: 640 });

// Auto notify UI on selection change
figma.on('selectionchange', () => {
  try {
    figma.ui.postMessage({ type: 'selection-change', selectionLength: figma.currentPage.selection.length, namespaces: collectAssignedNamespaces() });
  } catch (e) {
    // ignore
  }
});

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'load-settings': {
      const settings: Settings = {
        projectId: (await figma.clientStorage.getAsync('locize.projectId')) || '',
        apiKey: (await figma.clientStorage.getAsync('locize.apiKey')) || '',
        version: (await figma.clientStorage.getAsync('locize.version')) || 'latest',
        baseLanguage: (await figma.clientStorage.getAsync('locize.baseLanguage')) || 'en',
      };
      figma.ui.postMessage({ type: 'settings-loaded', settings });
      break;
    }
    case 'save-settings': {
      const s: Settings = msg.settings;
      await figma.clientStorage.setAsync('locize.projectId', s.projectId);
      await figma.clientStorage.setAsync('locize.apiKey', s.apiKey);
      await figma.clientStorage.setAsync('locize.version', s.version);
      await figma.clientStorage.setAsync('locize.baseLanguage', s.baseLanguage);
      figma.notify('Settings saved');
      break;
    }
    case 'scan-selection': {
      const namespace: string = msg.namespace || 'common';
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
      // merge persisted selection state
      try {
        const selMap = await getSelectionMap();
        for (const it of items) {
          it.selected = selMap[it.nodeId] !== false; // default true
        }
      } catch (e) { void e; }
      figma.ui.postMessage({ type: 'scan-result', items });
      break;
    }
    case 'apply-keys': {
      const items: ScanItem[] = msg.items;
      for (const item of items) {
        const node = await figma.getNodeByIdAsync(item.nodeId);
        if (node && node.type === 'TEXT') {
          const textNode = node as TextNode;
            // save key
          textNode.setPluginData(PLUGIN_KEY_KEY, item.key);
          if (!textNode.getPluginData(PLUGIN_ORIG_NAME_KEY)) {
            textNode.setPluginData(PLUGIN_ORIG_NAME_KEY, item.originalName || textNode.name);
          }
          try {
            textNode.name = item.key;
          } catch (error) {
            console.log(error);
          }
        }
      }
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
      figma.notify('Keys applied and names updated');
      break;
    }
    case 'apply-language': {
      const map: TranslationMap = msg.map;
      const namespace: string = msg.namespace;
      await applyTranslations(map, namespace);
      figma.notify('Language applied');
      break;
    }
    case 'get-assigned': {
      const namespace: string = msg.namespace || '';
      const sourceNodes: readonly SceneNode[] = figma.currentPage.selection.length ? figma.currentPage.selection : figma.currentPage.children;
      const textNodes = collectTextNodes(sourceNodes);
      const selMap = await getSelectionMap();
      const items: ScanItem[] = textNodes.filter(n => n.getPluginData(PLUGIN_KEY_KEY)).map(n => {
        const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
        const dotIndex = fullKey.indexOf('.');
        const ns = dotIndex > -1 ? fullKey.slice(0, dotIndex) : '';
        const local = dotIndex > -1 ? fullKey.slice(dotIndex + 1) : fullKey;
        return {
          nodeId: n.id,
          name: n.name,
          originalName: n.getPluginData(PLUGIN_ORIG_NAME_KEY) || n.name,
          text: n.characters,
          key: fullKey,
          namespace: ns,
          localKey: local,
          existing: true,
          selected: selMap[n.id] !== false,
        };
      }).filter(i => !namespace || i.key.startsWith(namespace + '.'));
      figma.ui.postMessage({ type: 'assigned-result', items });
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
      break;
    }
    case 'restore-names': {
      const items: { nodeId: string }[] = msg.items || [];
      for (const it of items) {
        const node = await figma.getNodeByIdAsync(it.nodeId);
        if (node && node.type === 'TEXT') {
          const textNode = node as TextNode;
          const orig = textNode.getPluginData(PLUGIN_ORIG_NAME_KEY);
          if (orig) {
            try {
              textNode.name = orig;
            } catch (error) {
              console.log(error);
            }
          }
        }
      }
      figma.notify('Names restored');
      const sourceNodes: readonly SceneNode[] = figma.currentPage.selection.length ? figma.currentPage.selection : figma.currentPage.children;
      const textNodes = collectTextNodes(sourceNodes);
      const selMap = await getSelectionMap();
      const itemsOut: ScanItem[] = textNodes.filter(n => n.getPluginData(PLUGIN_KEY_KEY)).map(n => {
        const fullKey = n.getPluginData(PLUGIN_KEY_KEY);
        const dotIndex = fullKey.indexOf('.');
        const ns = dotIndex > -1 ? fullKey.slice(0, dotIndex) : '';
        const local = dotIndex > -1 ? fullKey.slice(dotIndex + 1) : fullKey;
        return {
          nodeId: n.id,
          name: n.name,
          originalName: n.getPluginData(PLUGIN_ORIG_NAME_KEY) || n.name,
          text: n.characters,
          key: fullKey,
          namespace: ns,
          localKey: local,
          existing: true,
          selected: selMap[n.id] !== false,
        };
      });
      figma.ui.postMessage({ type: 'assigned-result', items: itemsOut });
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
      break;
    }
    case 'get-namespaces': {
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
      break;
    }
    case 'set-selected': {
      const nodeId: string = msg.nodeId;
      const selected: boolean = !!msg.selected;
      await setSelection(nodeId, selected);
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
  }
};
