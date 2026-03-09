import type { ExtensionModule } from "@renre-kit/extension-sdk";

// In-memory cache of loaded extension modules
const moduleCache = new Map<string, ExtensionModule>();

export async function loadExtensionModule(
  extensionName: string,
  version: string,
  baseUrl: string
): Promise<ExtensionModule> {
  const cacheKey = `${extensionName}@${version}`;

  if (moduleCache.has(cacheKey)) {
    return moduleCache.get(cacheKey)!;
  }

  // Dynamic import from worker service static URL
  const bundleUrl = `${baseUrl}/extensions/${extensionName}/${version}/ui/index.js`;

  try {
    const module = await import(/* @vite-ignore */ bundleUrl);
    const extModule = module.default as ExtensionModule;

    // Validate the module shape
    if (!extModule.pages || typeof extModule.pages !== "object") {
      throw new Error(`Extension "${extensionName}" UI module missing "pages" export`);
    }

    moduleCache.set(cacheKey, extModule);
    return extModule;
  } catch (error) {
    throw new Error(
      `Failed to load UI for "${extensionName}@${version}": ${String(error)}`
    );
  }
}

// Clear cache on extension upgrade/remount
export function invalidateExtensionModule(extensionName: string): void {
  for (const key of moduleCache.keys()) {
    if (key.startsWith(`${extensionName}@`)) {
      moduleCache.delete(key);
    }
  }
}
