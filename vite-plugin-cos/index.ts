import type { Plugin } from 'vite';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createFilter } from '@rollup/pluginutils';

export interface CosPluginOptions {
  /**
   * Pattern to include chunks to be managed by COS.
   * Matches against the output filename (e.g. `assets/vendor-*.js`).
   * Default: `['**\/*']` (all chunks, except the entry implementation detail)
   */
  include?: string | RegExp | (string | RegExp)[];

  /**
   * Pattern to exclude chunks from being managed by COS.
   */
  exclude?: string | RegExp | (string | RegExp)[];
}

export default function cosPlugin(options: CosPluginOptions = {}): Plugin {
  const filter = createFilter(options.include || ['**/*'], options.exclude);

  // Resolve loader path relative to this file
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const loaderPath = path.resolve(__dirname, 'loader.js');

  return {
    name: 'vite-plugin-cos',
    apply: 'build',
    enforce: 'post',



    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Disable standard entry script to let the COS loader handle it
        return html.replace(
          /<script\s+[^>]*type=["']module["'][^>]*src=["'][^"']*index[^"']*["'][^>]*><\/script>/gi,
          '<!-- Entry script disabled by COS Plugin -->'
        );
      }
    },

    async generateBundle(_options, bundle) {
      const managedChunks: Record<string, any> = {};
      let mainChunk: any = null;
      let htmlAsset: any = null;

      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === 'chunk') {
          if (chunk.isEntry) {
            mainChunk = chunk;
          } else {
            // Apply filter to determine if this chunk should be managed by COS
            if (filter(fileName)) {
              managedChunks[fileName] = chunk;
            }
          }
        }
        if (fileName === 'index.html' && chunk.type === 'asset') {
          htmlAsset = chunk;
        }
      }

      if (Object.keys(managedChunks).length > 0 && mainChunk) {
        const manifest: Record<string, any> = {};

        // Generate hashes and global variables for managed chunks
        for (const fileName in managedChunks) {
          const chunk = managedChunks[fileName];
          const hash = crypto.createHash('sha256').update(chunk.code).digest('hex');
          const globalVarName = `__COS_CHUNK_${hash.substring(0, 8)}__`;

          manifest[fileName] = {
            file: `/${fileName}`,
            hash: hash,
            globalVar: globalVarName
          };
        }

        // Rewrite imports in ALL chunks (both main entry and managed chunks)
        // This ensures dependencies between managed chunks and from entry to managed chunks are handled.
        // We do NOT rewrite imports to chunks that are NOT in the manifest (unmanaged chunks).
        const allChunks = [mainChunk, ...Object.values(managedChunks)];

        for (const targetChunk of allChunks) {
          for (const fileName in manifest) {
            // Avoid self-reference
            if (targetChunk.fileName === fileName) continue;

            const { globalVar } = manifest[fileName];
            // Use basename for matching relative imports
            const chunkBasename = fileName.split('/').pop()!;
            const escapedName = chunkBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Regex to find static imports of the managed chunk
            const pattern = `import\\s*\\{([^}]+)\\}\\s*from\\s*['"]\\.\\/${escapedName}['"];?`;
            const importRegex = new RegExp(pattern, 'g');

            if (importRegex.test(targetChunk.code)) {
              targetChunk.code = targetChunk.code.replace(importRegex, (_match: string, bindings: string) => {
                const destructuringPattern = bindings.split(',').map(b => {
                  const parts = b.trim().split(/\s+as\s+/);
                  return parts.length === 2 ? `${parts[0]}:${parts[1]}` : parts[0];
                }).join(',');
                return `const {${destructuringPattern}}=await import(window.${globalVar}||"./${fileName}");`;
              });
            }
          }
        }

        manifest['index'] = {
          file: `/${mainChunk.fileName}`
        };

        // Inject loader and inlined manifest into index.html
        if (htmlAsset) {
          try {
            let loaderCode = fs.readFileSync(loaderPath, 'utf-8');
            loaderCode = loaderCode.replace('__COS_MANIFEST__', JSON.stringify(manifest));

            let htmlSource = htmlAsset.source as string;

            // Remove modulepreload links to avoid double fetching keys we manage
            htmlSource = htmlSource.replace(
              /<link\s+[^>]*rel=["']modulepreload["'][^>]*>/gi,
              '<!-- modulepreload disabled by COS Plugin -->'
            );

            // Inject into head
            htmlAsset.source = htmlSource.replace(
              '<head>',
              () => `<head>\n<script id="cos-loader">${loaderCode}</script>`
            );
          } catch (e) {
            console.error('COS Plugin: Failed to read loader.js', e);
          }
        }
      }
    }
  };
}
