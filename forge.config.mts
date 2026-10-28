import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    // node-pty and the keyring are native modules Vite can't bundle: ship them beside the bundle and outside the asar.
    asar: { unpack: '**/node_modules/{node-pty,@napi-rs}/**' },
    ignore: (file) =>
      !!file &&
      !file.startsWith('/.vite') &&
      file !== '/package.json' &&
      file !== '/node_modules' &&
      !file.startsWith('/node_modules/node-pty') &&
      !file.startsWith('/node_modules/@napi-rs'),
  },
  // node-pty ships N-API prebuilds for Windows and macOS: a rebuild only adds a C++ toolchain requirement.
  rebuildConfig: { onlyModules: [] },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/backend/main.ts',
          config: 'vite.backend.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
