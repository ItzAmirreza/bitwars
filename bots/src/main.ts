import { HeadlessBitBot } from './bot.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type CliConfig = {
  count: number;
  prefix: string;
  uri: string;
  moduleName: string;
  tickMs: number;
  usernameFile: string;
};

function parseArgs(argv: string[]): CliConfig {
  const envCount = Number(process.env.BOT_COUNT ?? 10);
  const envTickMs = Number(process.env.BOT_TICK_MS ?? 33);
  const config: CliConfig = {
    count: Number.isFinite(envCount) && envCount > 0 ? Math.floor(envCount) : 10,
    prefix: process.env.BOT_PREFIX ?? 'BOT',
    uri:
      process.env.SPACETIMEDB_URI ??
      process.env.VITE_SPACETIMEDB_URI ??
      'wss://maincloud.spacetimedb.com',
    moduleName:
      process.env.SPACETIMEDB_MODULE ??
      process.env.VITE_MODULE_NAME ??
      'bitwars',
    tickMs: Number.isFinite(envTickMs) && envTickMs > 0 ? Math.floor(envTickMs) : 33,
    usernameFile:
      process.env.BOT_USERNAME_FILE ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../gamer_usernames.txt'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (!arg) continue;
    if (arg === '--count' && value) {
      config.count = Math.max(1, Math.floor(Number(value) || config.count));
      i++;
    } else if (arg === '--prefix' && value) {
      config.prefix = value;
      i++;
    } else if (arg === '--uri' && value) {
      config.uri = value;
      i++;
    } else if (arg === '--module' && value) {
      config.moduleName = value;
      i++;
    } else if (arg === '--tick-ms' && value) {
      config.tickMs = Math.max(20, Math.floor(Number(value) || config.tickMs));
      i++;
    } else if (arg === '--username-file' && value) {
      config.usernameFile = path.resolve(value);
      i++;
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: npm run bots -- --count 10 --prefix BOT',
          '',
          'Flags:',
          '  --count <n>',
          '  --prefix <name>',
          '  --uri <spacetimedb websocket uri>',
          '  --module <database name>',
          '  --tick-ms <loop interval>',
          '  --username-file <path to username list>',
        ].join('\n'),
      );
      process.exit(0);
    }
  }

  return config;
}

function loadUsernames(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const name = rawLine.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}

function chooseBotNames(config: CliConfig): string[] {
  const usernames = loadUsernames(config.usernameFile);
  shuffleInPlace(usernames);

  const chosen: string[] = [];
  for (let i = 0; i < config.count; i++) {
    if (i < usernames.length) {
      chosen.push(usernames[i]!);
      continue;
    }
    chosen.push(`${config.prefix}-${String(i + 1).padStart(2, '0')}`);
  }
  return chosen;
}

const config = parseArgs(process.argv.slice(2));
const tokenDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.context/bot-tokens');
const botNames = chooseBotNames(config);
const bots = Array.from({ length: config.count }, (_, index) => {
  return new HeadlessBitBot({
    index,
    name: botNames[index] ?? `${config.prefix}-${String(index + 1).padStart(2, '0')}`,
    uri: config.uri,
    moduleName: config.moduleName,
    tickMs: config.tickMs,
    tokenDir,
  });
});

for (const bot of bots) {
  bot.start();
}

console.log(
  `[bots] started ${config.count} bot(s) on ${config.moduleName} via ${config.uri} at ${config.tickMs}ms tick`,
);

const shutdown = (): void => {
  for (const bot of bots) {
    bot.stop();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
