// Lists public/custom-art/*.png into index.json so the game knows which items have custom art.
// Name each file after the item, e.g. "Liger.png". Run automatically by `npm run build`.
import fs from 'node:fs';
const dir = 'public/custom-art';
fs.mkdirSync(dir, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
fs.writeFileSync(`${dir}/index.json`, JSON.stringify(files, null, 1));
console.log(`custom art: ${files.length} file(s)`);
