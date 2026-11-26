// 用法:
//   npm install && npm run build            (使用项目内的 three / esbuild)
//   node build.mjs <esbuild可执行文件> <含three的node_modules目录>   (手动指定)
// 产物: dist/confession-3d.html —— 单文件,双击即可打开,无需服务器。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, 'dist/bundle.js');
mkdirSync(resolve(root, 'dist'), { recursive: true });
const [esbuildBin, nodeModules] = process.argv.slice(2);
// legalComments:'inline' 会保留 three.js 的 MIT 版权声明(公开分发时必须保留)
const common = { bundle: true, minify: true, format: 'iife', target: 'es2020', legalComments: 'inline', logLevel: 'warning', outfile: out };

if (esbuildBin && nodeModules) {
  execFileSync(esbuildBin, [
    resolve(root, 'src/main.js'), '--bundle', '--minify', '--format=iife', '--target=es2020',
    '--legal-comments=inline', '--log-level=warning', `--outfile=${out}`,
  ], { env: { ...process.env, NODE_PATH: nodeModules }, stdio: 'inherit' });
} else {
  const { build } = await import('esbuild');
  await build({ ...common, entryPoints: [resolve(root, 'src/main.js')] });
}

const js = readFileSync(out, 'utf8').replace(/<\/script/gi, '<\\/script');
const html = readFileSync(resolve(root, 'index.template.html'), 'utf8').replace('<!--BUNDLE-->', () => `<script>${js}</script>`);
const dest = resolve(root, 'dist/confession-3d.html');
writeFileSync(dest, html);
// GitHub Pages 从 docs/ 目录提供页面
mkdirSync(resolve(root, 'docs'), { recursive: true });
writeFileSync(resolve(root, 'docs/index.html'), html);
console.log(`OK  ${dest}  (${(statSync(dest).size / 1024).toFixed(0)} KB)  +  docs/index.html`);
