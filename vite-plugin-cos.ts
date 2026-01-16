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
      let vendorChunk: any = null;
      let mainChunk: any = null;
      let htmlAsset: any = null;

      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === 'chunk') {
          if (chunk.name === 'vendor-react') vendorChunk = chunk;
          if (chunk.isEntry) mainChunk = chunk;
        }
        if (fileName === 'index.html' && chunk.type === 'asset') {
          htmlAsset = chunk;
        }
      }

      if (vendorChunk && mainChunk) {
        const hash = crypto.createHash('sha256').update(vendorChunk.code).digest('hex');
        const vendorFileName = vendorChunk.fileName.split('/').pop();
        const escapedVendorName = vendorFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match import { ... } from "./vendor..."
        const importRegex = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*['"]\\.\\/${escapedVendorName}['"];?`, 'g');
        const globalVarName = `__COS_VENDOR_${hash.substring(0, 8)}__`;

        // Rewrite static imports to dynamic imports using a global variable
        if (importRegex.test(mainChunk.code)) {
          mainChunk.code = mainChunk.code.replace(importRegex, (_match: string, bindings: string) => {
            const destructuringPattern = bindings.split(',').map(b => {
              const parts = b.trim().split(/\s+as\s+/);
              return parts.length === 2 ? `${parts[0]}:${parts[1]}` : parts[0];
            }).join(',');
            // IMPORTANT: "window" prefix is vital for the global variable fallback
            return `const {${destructuringPattern}}=await import(window.${globalVarName}||"./${vendorFileName}");`;
          });
        }

        const manifest = {
          'vendor-react': {
            file: `/${vendorChunk.fileName}`,
            hash: hash,
            globalVar: globalVarName
          },
          'index': {
            file: `/${mainChunk.fileName}`
          }
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
