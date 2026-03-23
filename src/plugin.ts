import type { Module } from "node:module";
import { pathToFileURL } from "node:url";

type PluginData = {
    name: string;
    module: Plugin;
};

interface Plugin extends Module {
    onInit: () => void;
    onFree: () => void;

    onRefresh?: () => void;
    onFetch?: () => void;
}

class PluginManager {
    plugins: PluginData[] = [];

    async discover(pluginPaths: string[]) {
        this.plugins = await Promise.all(
            pluginPaths.map(async name => {
                const fileUrl = pathToFileURL(
                    `${__dirname}/../plugins/${name}/main.js`
                ).href;

                const imported = await import(fileUrl);

                return {
                    name,
                    module: (imported.default ?? imported) as Plugin
                };
            })
        );
    }

    initAll() {
        this.plugins.forEach(plugin => {
            console.log(`[INIT] Starting: ${plugin.name}`);
            plugin.module.onInit();
            console.log(`[INIT] Started: ${plugin.name}`);
        });
    }

    freeAll() {
        this.plugins.forEach(plugin => {
            console.log(`[FREE] Freeing: ${plugin.name}`);
            plugin.module.onFree();
            console.log(`[FREE] Freed: ${plugin.name}`);
        });
    }

    refreshAll() {
        this.plugins.forEach(plugin => {
            if (!plugin.module.onRefresh) return;

            console.log(`[REFRESH] Refreshing: ${plugin.name}`);
            plugin.module.onRefresh();
            console.log(`[REFRESH] Refreshed: ${plugin.name}`);
        });
    }

    fetchAll() {
        this.plugins.forEach(plugin => {
            if (!plugin.module.onFetch) return;

            console.log(`[FETCH] Fetching: ${plugin.name}`);
            plugin.module.onFetch();
            console.log(`[FETCH] Fetched: ${plugin.name}`);
        });
    }
}

export { PluginManager };
