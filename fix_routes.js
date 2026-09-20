const fs = require('fs');
let content = fs.readFileSync('src/routes/posts.ts', 'utf8');
content = content.replace(/scheduleFeedRefresh\(c\.env, executionCtxOf\(c\)\);/g, 'scheduleFeedRefresh(c.env, c as any);');
fs.writeFileSync('src/routes/posts.ts', content);
