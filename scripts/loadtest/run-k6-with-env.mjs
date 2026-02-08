import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node run-k6-with-env.mjs <k6 args...>');
  process.exit(1);
}

const k6Binary = process.env.K6_BIN || 'k6';

const child = spawn(k6Binary, args, {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    SUPABASE_ANON_KEY:
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  },
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  if (String(error?.message || '').toLowerCase().includes('not found')) {
    console.error('k6 was not found. Set K6_BIN to your k6 executable path (for example C:\\\\Tools\\\\k6\\\\k6.exe).');
  }
  console.error(error.message || error);
  process.exit(1);
});
