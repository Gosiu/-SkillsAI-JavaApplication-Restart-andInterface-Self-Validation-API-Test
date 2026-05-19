#!/usr/bin/env node

/**
 * check-port.js v3.0 - Port Status Checker (Node.js)
 * 
 * Features:
 * - Check if port is in use
 * - Get listening process info
 * - Fast async operation
 */

const net = require('net');
const { exec } = require('child_process');

// Color codes
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m'
};

function colorize(text, color) {
    return `${colors[color] || ''}${text}${colors.reset}`;
}

// Parse arguments
const args = process.argv.slice(2);
let port = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = parseInt(args[++i]);
}

if (!port) {
    console.error(colorize('Error: --port is required', 'red'));
    process.exit(1);
}

/**
 * Check if port is in use using net module (fastest method)
 */
function checkPortFast(portNum) {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve({ inUse: true });
            } else {
                resolve({ inUse: false, error: err.message });
            }
        });
        
        server.once('listening', () => {
            server.close();
            resolve({ inUse: false });
        });
        
        server.listen(portNum, '127.0.0.1');
    });
}

/**
 * Get detailed info about process using the port
 */
function getPortProcessInfo(portNum) {
    return new Promise((resolve) => {
        exec(`netstat -ano | findstr :${portNum} | findstr LISTENING`, (err, stdout) => {
            if (err || !stdout.trim()) {
                resolve(null);
                return;
            }

            const lines = stdout.split('\n').filter(line => line.trim());
            const results = [];

            lines.forEach(line => {
                const match = line.match(/\s+(\d+)\s*$/);
                if (match) {
                    results.push({
                        port: portNum,
                        pid: parseInt(match[1]),
                        state: 'LISTENING'
                    });
                }
            });

            resolve(results.length > 0 ? results : null);
        });
    });
}

async function main() {
    console.log(`\n[check-port] Checking port ${port}...`);
    
    // Fast check first
    const fastResult = await checkPortFast(port);

    if (!fastResult.inUse) {
        console.log(colorize(`   [INFO] Port ${port} is FREE`, 'cyan'));
        
        const result = {
            success: true,
            port: port,
            inUse: false,
            processInfo: null
        };
        
        console.log(JSON.stringify(result));
        process.exit(0);
    }

    // Port is in use, get details
    console.log(colorize(`   [INFO] Port ${port} is IN USE`, 'yellow'));

    const processInfo = await getPortProcessInfo(port);

    if (processInfo && processInfo.length > 0) {
        console.log(colorize(`   [DETAILS] Found ${processInfo.length} process(es):`, 'yellow'));
        
        processInfo.forEach((info, idx) => {
            console.log(`      ${idx + 1}. PID: ${info.pid} | State: ${info.state}`);
        });

        const result = {
            success: true,
            port: port,
            inUse: true,
            processInfo: processInfo
        };

        console.log(JSON.stringify(result));
        process.exit(0);
    } else {
        console.log(colorize(`   [WARNING] Port in use but couldn't get process info`, 'red'));

        const result = {
            success: true,
            port: port,
            inUse: true,
            processInfo: null
        };

        console.log(JSON.stringify(result));
        process.exit(0);
    }
}

main().catch(err => {
    console.error(colorize(`Fatal error: ${err.message}`, 'red'));
    process.exit(2);
});
