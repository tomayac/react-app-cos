import type { Plugin } from 'vite';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export default function cosPlugin(): Plugin {
  let config: any;

  return {
    name: 'vite-plugin-cos',
    apply: 'build',

    enforce: 'post', // Ensure we run after other plugins (like HTML)

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

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
            managedChunks[fileName] = chunk;
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
        // to support dependencies between chunks (e.g., react-dom importing react)
        const allChunks = [mainChunk, ...Object.values(managedChunks)];

        for (const targetChunk of allChunks) {
          for (const fileName in manifest) {
            // Avoid self-reference
            if (targetChunk.fileName === fileName) continue;

            const { globalVar } = manifest[fileName];
            // Use basename for matching relative imports within the same directory (which is effective for dist/assets)
            const chunkBasename = fileName.split('/').pop()!;
            const escapedName = chunkBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
          const loaderPath = path.resolve(config.root, 'src/cos-loader.js');
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
        }
      }
    }
  };
}
