#!/usr/bin/env node

/**
 * watcher.js - Auto File Change Watcher for App Restarter
 * 
 * Automatically detects Java file changes and triggers module restart
 * Features:
 * - Real-time file monitoring
 * - Debounce mechanism (prevents rapid restarts)
 * - Module auto-detection
 * - Configurable watch paths
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

function colorize(text, color) {
    return `${colors[color] || ''}${text}${colors.reset}`;
}

const scriptDir = __dirname;
const rootDir = path.resolve(scriptDir, '..', '..', '..', '..');
const configPath = path.join(scriptDir, '..', 'config.json');

const DEBOUNCE_MS = 2000;

const moduleWatchPaths = {
    app: path.join(rootDir, 'cereshop-app', 'src', 'main', 'java'),
    business: path.join(rootDir, 'cereshop-business', 'src', 'main', 'java'),
    admin: path.join(rootDir, 'cereshop-admin', 'src', 'main', 'java')
};

const pendingRestarts = {};
const lastRestartTime = {};

function loadConfig() {
    try {
        const configData = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(configData);
    } catch (err) {
        console.error(colorize(`[ERROR] Failed to load config: ${err.message}`, 'red'));
        return null;
    }
}

function detectModuleFromPath(filePath) {
    const normalizedPath = path.normalize(filePath);
    
    for (const [moduleName, watchPath] of Object.entries(moduleWatchPaths)) {
        const normalizedWatchPath = path.normalize(watchPath);
        if (normalizedPath.startsWith(normalizedWatchPath)) {
            return moduleName;
        }
    }
    return null;
}

function triggerRestart(moduleName, changedFile) {
    const now = Date.now();
    
    if (lastRestartTime[moduleName] && (now - lastRestartTime[moduleName]) < DEBOUNCE_MS) {
        console.log(colorize(`[DEBOUNCE] Skipping restart for ${moduleName} (too soon)`, 'yellow'));
        return;
    }

    if (pendingRestarts[moduleName]) {
        clearTimeout(pendingRestarts[moduleName]);
    }

    pendingRestarts[moduleName] = setTimeout(() => {
        console.log('\n' + '='.repeat(60));
        console.log(colorize(`[AUTO-RESTART] Triggered by file change`, 'cyan'));
        console.log(colorize(`   Module: ${moduleName}`, 'cyan'));
        console.log(colorize(`   File: ${path.relative(rootDir, changedFile)}`, 'gray'));
        console.log('='.repeat(60) + '\n');

        lastRestartTime[moduleName] = Date.now();
        
        const restartScript = path.join(scriptDir, 'restart-module.js');
        const restartProcess = spawn('node', [restartScript, '--module', moduleName], {
            cwd: rootDir,
            stdio: 'inherit',
            shell: true
        });

        restartProcess.on('close', (code) => {
            if (code === 0) {
                console.log(colorize(`\n[AUTO-RESTART] ${moduleName} restarted successfully`, 'green'));
            } else {
                console.log(colorize(`\n[AUTO-RESTART] ${moduleName} restart failed (exit code: ${code})`, 'red'));
            }
            pendingRestarts[moduleName] = null;
        });

        restartProcess.on('error', (err) => {
            console.error(colorize(`[ERROR] Failed to restart ${moduleName}: ${err.message}`, 'red'));
            pendingRestarts[moduleName] = null;
        });
    }, DEBOUNCE_MS);
}

function watchDirectory(dirPath, moduleName) {
    if (!fs.existsSync(dirPath)) {
        console.log(colorize(`[WARNING] Directory not found: ${dirPath}`, 'yellow'));
        return null;
    }

    console.log(colorize(`[WATCH] Monitoring: ${path.relative(rootDir, dirPath)}`, 'blue'));

    const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        
        if (!filename.endsWith('.java')) return;

        const fullPath = path.join(dirPath, filename);
        
        if (eventType === 'change') {
            const now = new Date().toTimeString().substring(0, 8);
            console.log(`\n[${now}] ${colorize('[FILE-CHANGE]', 'magenta')} ${path.relative(rootDir, fullPath)}`);
            triggerRestart(moduleName, fullPath);
        }
    });

    watcher.on('error', (err) => {
        console.error(colorize(`[ERROR] Watcher error for ${moduleName}: ${err.message}`, 'red'));
    });

    return watcher;
}

function main() {
    console.log('');
    console.log('='.repeat(60));
    console.log(colorize('   App Restarter - Auto File Watcher', 'cyan'));
    console.log(colorize('   Watching for Java file changes...', 'gray'));
    console.log('='.repeat(60));

    const config = loadConfig();
    if (!config) {
        process.exit(1);
    }

    const watchers = [];
    const enabledModules = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    
    const modulesToWatch = enabledModules.length > 0 
        ? enabledModules 
        : Object.keys(moduleWatchPaths);

    console.log('\n[CONFIGURATION]');
    console.log(`   Debounce: ${DEBOUNCE_MS}ms`);
    console.log(`   Modules: ${modulesToWatch.join(', ')}`);
    console.log('');

    for (const moduleName of modulesToWatch) {
        if (!moduleWatchPaths[moduleName]) {
            console.log(colorize(`[WARNING] Unknown module: ${moduleName}`, 'yellow'));
            continue;
        }

        const watcher = watchDirectory(moduleWatchPaths[moduleName], moduleName);
        if (watcher) {
            watchers.push({ moduleName, watcher });
        }
    }

    if (watchers.length === 0) {
        console.error(colorize('[ERROR] No directories to watch', 'red'));
        process.exit(1);
    }

    console.log('\n' + colorize('[READY] File watcher active. Press Ctrl+C to stop.', 'green'));
    console.log('');

    process.on('SIGINT', () => {
        console.log('\n\n[SHUTDOWN] Closing all watchers...');
        watchers.forEach(({ moduleName, watcher }) => {
            watcher.close();
            console.log(`   Closed watcher for ${moduleName}`);
        });
        process.exit(0);
    });
}

main();
