// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// Locize integration plugin main code

interface Settings {
  projectId: string;
  apiKey: string; // write key
  version: string; // e.g. 'latest' or environment version
  defaultNamespace: string;
  baseLanguage: string;
}

interface ScanItem {
  nodeId: string;
  name: string;
  originalName: string;
  text: string;
  key: string; // полный ключ namespace.local
  namespace: string; // namespace
  localKey: string; // часть без namespace
  existing: boolean;
}

interface TranslationMap { [key: string]: string; }

const PLUGIN_KEY_KEY = 'locize:key';
const PLUGIN_ORIG_NAME_KEY = 'locize:origName';

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

// Авто уведомление UI об изменении выделения
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
        defaultNamespace: (await figma.clientStorage.getAsync('locize.defaultNamespace')) || 'common',
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
      await figma.clientStorage.setAsync('locize.defaultNamespace', s.defaultNamespace);
      await figma.clientStorage.setAsync('locize.baseLanguage', s.baseLanguage);
      figma.notify('Настройки сохранены');
      break;
    }
    case 'scan-selection': {
      const namespace: string = msg.namespace || 'common';
      const selection = figma.currentPage.selection;
      if (!selection.length) {
        figma.ui.postMessage({ type: 'scan-result', items: [], warning: 'Нет выделения' });
        break;
      }
      const textNodes = collectTextNodes(selection as readonly SceneNode[]);
      if (!textNodes.length) {
        figma.ui.postMessage({ type: 'scan-result', items: [], warning: 'Текстовые ноды не найдены' });
        break;
      }
      const items = generateKeys(textNodes, namespace);
      figma.ui.postMessage({ type: 'scan-result', items });
      break;
    }
    case 'apply-keys': {
      const items: ScanItem[] = msg.items;
      for (const item of items) {
        const node = await figma.getNodeByIdAsync(item.nodeId);
        if (node && node.type === 'TEXT') {
          const textNode = node as TextNode;
            // сохранить ключ
          textNode.setPluginData(PLUGIN_KEY_KEY, item.key);
          if (!textNode.getPluginData(PLUGIN_ORIG_NAME_KEY)) {
            textNode.setPluginData(PLUGIN_ORIG_NAME_KEY, item.originalName || textNode.name);
          }
          try { textNode.name = item.key; } catch {}
        }
      }
      figma.ui.postMessage({ type: 'namespaces-result', namespaces: collectAssignedNamespaces() });
      figma.notify('Ключи применены и имена обновлены');
      break;
    }
    case 'apply-language': {
      const map: TranslationMap = msg.map;
      const namespace: string = msg.namespace;
      await applyTranslations(map, namespace);
      figma.notify('Применён язык');
      break;
    }
    case 'get-assigned': {
      const namespace: string = msg.namespace || '';
      const sourceNodes: readonly SceneNode[] = figma.currentPage.selection.length ? figma.currentPage.selection : figma.currentPage.children;
      const textNodes = collectTextNodes(sourceNodes);
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
          if (orig) { try { textNode.name = orig; } catch {} }
        }
      }
      figma.notify('Имена восстановлены');
      const sourceNodes: readonly SceneNode[] = figma.currentPage.selection.length ? figma.currentPage.selection : figma.currentPage.children;
      const textNodes = collectTextNodes(sourceNodes);
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
    case 'close': {
      figma.closePlugin();
      break;
    }
  }
};
