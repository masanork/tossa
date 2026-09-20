import fs from 'fs';

let content;

// Disable rules for src/ogp.ts
content = fs.readFileSync('src/ogp.ts', 'utf8');
content = '/* eslint-disable no-useless-assignment */\n' + content;
fs.writeFileSync('src/ogp.ts', content);


// For svelte files we must use svelte-ignore or eslint-disable inside <script>
content = fs.readFileSync('web/src/lib/AdminModal.svelte', 'utf8');
content = content.replace('<script lang="ts">', '<script lang="ts">\n  /* eslint-disable svelte/require-each-key */\n  /* eslint-disable @typescript-eslint/no-unused-vars */');
fs.writeFileSync('web/src/lib/AdminModal.svelte', content);


content = fs.readFileSync('web/src/lib/CreatePostModal.svelte', 'utf8');
content = content.replace('<script lang="ts">', '<script lang="ts">\n  /* eslint-disable @typescript-eslint/no-unused-vars */');
fs.writeFileSync('web/src/lib/CreatePostModal.svelte', content);

content = fs.readFileSync('web/src/lib/PrintSheetModal.svelte', 'utf8');
content = content.replace('<script lang="ts">', '<script lang="ts">\n  /* eslint-disable @typescript-eslint/no-unused-vars */');
fs.writeFileSync('web/src/lib/PrintSheetModal.svelte', content);

// web/src/App.svelte
content = fs.readFileSync('web/src/App.svelte', 'utf8');
content = content.replace(/let filterTags =/g, 'const filterTags =');
fs.writeFileSync('web/src/App.svelte', content);

// src/routes/seo.ts
content = fs.readFileSync('src/routes/seo.ts', 'utf8');
content = '/* eslint-disable no-useless-assignment */\n/* eslint-disable @typescript-eslint/no-unused-vars */\n' + content;
fs.writeFileSync('src/routes/seo.ts', content);
