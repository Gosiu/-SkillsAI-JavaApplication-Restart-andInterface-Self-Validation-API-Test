#!/usr/bin/env node

/**
 * kill-process.js v3.0 - Process Killer (Node.js)
 * 
 * Features:
 * - Find and kill process by port
 * - Multiple retry attempts
 * - Force kill support
 */

const { exec } = require('child_process');

// Color codes
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m'
};

function colorize(text, color) {
    return `${colors[color] || ''}${text}${colors.reset}`;
}

// Parse arguments
const args = process.argv.slice(2);
let port = null;
let maxAttempts = 3;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = parseInt(args[++i]);
    if (args[i] === '--max-attempts') maxAttempts = parseInt(args[++i]);
}

if (!port) {
    console.error(colorize('Error: --port is required', 'red'));
    process.exit(1);
}

/**
 * Execute command with Promise
 */
function execCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            resolve({ error, stdout, stderr });
        });
    });
}

/**
 * Sleep function
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log(`\n[kill-process] Closing process on port ${port}...`);
    
    let killedPid = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`   Attempt ${attempt}/${maxAttempts}...`);
        
        try {
            // Find processes using the port
            const result = await execCommand(`netstat -ano | findstr :${port}`);
            const lines = result.stdout.split('\n').filter(line => line.includes('LISTENING'));
            
            if (lines.length === 0) {
                console.log(colorize(`   [INFO] No process found on port ${port}`, 'yellow'));
                break;
            }

            // Extract PIDs
            const pids = new Set();
            lines.forEach(line => {
                const match = line.match(/\s+(\d+)\s*$/);
                if (match) pids.add(match[1]);
            });

            // Kill each PID
            for (const pid of pids) {
                console.log(`   Found PID: ${pid}...`);
                
                const killResult = await execCommand(`taskkill /PID ${pid} /F`);
                
                if (killResult.stderr.includes('SUCCESS')) {
                    console.log(colorize(`   [SUCCESS] Process ${pid} terminated`, 'green'));
                    killedPid = pid;
                } else if (killResult.stderr.includes('not found')) {
                    console.log(colorize(`   [INFO] Process ${pid} already terminated`, 'yellow'));
                    killedPid = pid;
                } else {
                    console.log(colorize(`   [WARNING] Could not terminate ${pid}`, 'red'));
                }
            }

            // If we killed something, check again after brief pause
            if (killedPid && attempt < maxAttempts) {
                await sleep(500); // Wait 500ms before rechecking
                continue;
            }

            break; // Exit loop

        } catch (err) {
            console.error(colorize(`   [ERROR] Command failed: ${err.message}`, 'red'));
            break;
        }
    }

    // Final status
    if (killedPid) {
        console.log(colorize(`\n[KILL COMPLETE] Process(es) on port ${port} terminated`, 'green'));
        
        const result = { success: true, killedPid };
        console.log(JSON.stringify(result));
        process.exit(0);
    } else {
        console.log(colorize(`\n[KILL SKIPPED] No active process found on port ${port}`, 'yellow'));
        
        const result = { success: true, killedPid: null };
        console.log(JSON.stringify(result));
        process.exit(0);
    }
}

main().catch(err => {
    console.error(colorize(`Fatal error: ${err.message}`, 'red'));
    process.exit(2);
});
