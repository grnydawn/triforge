import { main } from './server';

main().catch((e) => { console.error('triforge-mcp fatal:', e); process.exit(1); });
