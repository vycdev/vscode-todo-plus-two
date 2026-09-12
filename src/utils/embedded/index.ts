/* IMPORT */

import * as execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import Config from '../../config';
import AG from './providers/ag';
import JS from './providers/js';
import RG from './providers/rg';
import { resetEmbeddedProvider } from './provider-lifecycle';
import { getCoreRipgrepPath } from './ripgrep';

declare const __non_webpack_require__: NodeRequire;

/* EMBEDDED */

const Embedded = {
  initProvider(): Promise<void> {
    if (Embedded.disposed) return Promise.resolve();
    if (Embedded.provider) return Promise.resolve();
    if (Embedded.providerInitialization) return Embedded.providerInitialization;

    const initialization = Embedded.createProvider();
    Embedded.providerInitialization = initialization;
    const clearInitialization = () => {
      if (Embedded.providerInitialization === initialization) {
        Embedded.providerInitialization = undefined;
      }
    };
    initialization.then(clearInitialization, clearInitialization);

    return initialization;
  },

  async createProvider(): Promise<void> {
    const { javascript, ag, rg } = Embedded.providers;
    const cfg = Config.get();
    const preferred = cfg.embedded.provider; // "javascript" | "ag" | "rg" | ""
    const generation = Embedded.providerGeneration;

    let Provider;

    if (preferred) {
      // Honor explicit preference, but fall back gracefully
      const pick = await (Embedded.providers[preferred]
        ? Embedded.providers[preferred]()
        : undefined);
      Provider = pick || javascript();
    } else {
      // Auto-detect fast providers, then fall back to JS
      Provider = (await ag()) || (await rg()) || javascript();
    }

    if (Embedded.disposed) return;
    if (generation !== Embedded.providerGeneration) return Embedded.createProvider();

    Embedded.provider = new Provider();
  },

  resetProvider() {
    resetEmbeddedProvider(Embedded);
  },

  dispose() {
    Embedded.disposed = true;
    Embedded.resetProvider();
  },

  disposed: false,
  provider: undefined as JS | AG | RG,
  providerInitialization: undefined as Promise<void> | undefined,
  providerGeneration: 0,

  providers: {
    javascript() {
      return JS;
    },

    async ag() {
      try {
        await execa('ag', ['--version']);

        return AG;
      } catch (e) {}
    },

    async rg() {
      const config = Config.get(),
        lookaroundRe = /\(\?<?(!|=)/;

      if (lookaroundRe.test(config.embedded.providers.rg.regex)) {
        vscode.window.showErrorMessage(
          'ripgrep doesn\'t support lookaheads and lookbehinds, you have to update your "todo.embedded.providers.rg.regex" setting if you want to use ripgrep'
        );

        return;
      }

      try {
        await execa('rg', ['--version']);

        RG.bin = 'rg';
        return RG;
      } catch (e) {}

      const rgPath = getCoreRipgrepPath(vscode.env.appRoot, __non_webpack_require__);

      if (rgPath) {
        RG.bin = rgPath;

        return RG;
      }

      const name = /^win/.test(process.platform) ? 'rg.exe' : 'rg',
        basePath = path.dirname(__dirname),
        filePaths = [
          path.join(basePath, `node_modules.asar.unpacked/vscode-ripgrep/bin/${name}`),
          path.join(basePath, `node_modules.asar.unpacked/@vscode/ripgrep/bin/${name}`),
          path.join(basePath, `node_modules/vscode-ripgrep/bin/${name}`),
          path.join(basePath, `node_modules/@vscode/ripgrep/bin/${name}`),
        ];

      for (let filePath of filePaths) {
        try {
          fs.accessSync(filePath);

          RG.bin = filePath;

          return RG;
        } catch (e) {}
      }
    },
  },
};

/* EXPORT */

export default Embedded;
