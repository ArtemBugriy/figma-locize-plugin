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
  name: string; // текущее имя (может стать ключом)
  originalName: string; // исходное имя до замены
  text: string;
  key: string;
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
      used.add(key);
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
      key = finalKey;
      used.add(key);
    }
    items.push({
      nodeId: node.id,
      name: node.name,
      originalName: storedOriginal || node.name,
      text: node.characters,
      key: key.startsWith(namespace + '.') ? key : `${namespace}.${key}`,
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
    } else if (fullKey.startsWith(namespace + '.')) {
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
    figma.ui.postMessage({ type: 'selection-change', selectionLength: figma.currentPage.selection.length });
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
          // сохранить оригинальное имя, если ещё не сохранено
          if (!textNode.getPluginData(PLUGIN_ORIG_NAME_KEY)) {
            textNode.setPluginData(PLUGIN_ORIG_NAME_KEY, item.originalName || textNode.name);
          }
          // переименовать ноду в сам ключ
          try { textNode.name = item.key; } catch {}
        }
      }
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
      const items: ScanItem[] = textNodes.filter(n => n.getPluginData(PLUGIN_KEY_KEY)).map(n => ({
        nodeId: n.id,
        name: n.name,
        originalName: n.getPluginData(PLUGIN_ORIG_NAME_KEY) || n.name,
        text: n.characters,
        key: n.getPluginData(PLUGIN_KEY_KEY),
        existing: true,
      })).filter(i => !namespace || i.key.startsWith(namespace + '.'));
      figma.ui.postMessage({ type: 'assigned-result', items });
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
              try { textNode.name = orig; } catch {}
            }
        }
      }
      figma.notify('Имена восстановлены');
      // Обновим текущий список если режим assigned
      const sourceNodes: readonly SceneNode[] = figma.currentPage.selection.length ? figma.currentPage.selection : figma.currentPage.children;
      const textNodes = collectTextNodes(sourceNodes);
      const namespace = '';
      const itemsOut: ScanItem[] = textNodes.filter(n => n.getPluginData(PLUGIN_KEY_KEY)).map(n => ({
        nodeId: n.id,
        name: n.name,
        originalName: n.getPluginData(PLUGIN_ORIG_NAME_KEY) || n.name,
        text: n.characters,
        key: n.getPluginData(PLUGIN_KEY_KEY),
        existing: true,
      }));
      figma.ui.postMessage({ type: 'assigned-result', items: itemsOut });
      break;
    }
    case 'close': {
      figma.closePlugin();
      break;
    }
  }
};
