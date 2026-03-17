import Module = require("node:module");

type PluginData = {
    name: string

    module: Plugin
};

interface Plugin extends Module {
    onInit: () => void;
    onFree: () => void;

    onRefresh?: () => void;
    onFetch?: () => void;
}

class PluginManager {
    plugins: PluginData[] = [];

    discover(pluginPaths: [string]) {
        this.plugins = pluginPaths.map(name => ({
            name,
            module: require(`${__dirname}/../plugins/${name}/main.js`)
        }));
    }


    initAll() {
        this.plugins.forEach(plugin => {
            console.log(`[INIT] Starting: ${plugin.name}`)
            plugin.module.onInit();
            console.log(`[INIT] Started: ${plugin.name}`)
        });
    }

    freeAll() {
        this.plugins.forEach(plugin => {
            console.log(`[FREE] Freeing: ${plugin.name}`)
            plugin.module.onFree();
            console.log(`[FREE] Freed: ${plugin.name}`)
        });
    }


    refreshAll() {
        this.plugins.forEach(plugin => {
            if (!plugin.module.onRefresh) return;

            console.log(`[REFRESH] Refreshing: ${plugin.name}`)
            plugin.module.onRefresh();
            console.log(`[REFRESH] Refreshed: ${plugin.name}`)
        });
    }

    fetchAll() {
        this.plugins.forEach(plugin => {
            if (!plugin.module.onFetch) return;

            console.log(`[FETCH] Fetching: ${plugin.name}`)
            plugin.module.onFetch();
            console.log(`[FETCH] Fetching: ${plugin.name}`)
        });
    }
}