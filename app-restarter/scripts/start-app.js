#!/usr/bin/env node

/**
 * start-app.js v3.0 - Application Startup Script (Node.js)
 * 
 * Features:
 * - Maven spring-boot:run with proper logging
 * - Background process execution
 * - Dual log output (stdout + stderr)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
let modulePath = null;
let port = null;
let profiles = null;
let jvmArgs = '-Xms512m -Xmx1024m';
let mavenHome = null;
let mavenSettings = null;

for (let i = 0; i < args.length; i++) {
    switch(args[i]) {
        case '--module': modulePath = args[++i]; break;
        case '--port': port = parseInt(args[++i]); break;
        case '--profiles': profiles = args[++i]; break;
        case '--jvm-args': jvmArgs = args[++i]; break;
        case '--maven-home': mavenHome = args[++i]; break;
        case '--settings': mavenSettings = args[++i]; break;
    }
}

if (!modulePath || !port) {
    console.error(colorize('Error: --module and --port are required', 'red'));
    process.exit(1);
}

async function main() {
    const rootDir = path.join(__dirname, '..', '..');

    console.log('\n[start-app] Starting application via Maven');
    console.log('='.repeat(50));
    console.log(`   Module: ${modulePath}`);
    console.log(`   Port: ${port}`);
    if (profiles) console.log(`   Profile: ${profiles}`);
    console.log(`   JVM Args: ${jvmArgs}`);

    // Setup log files
    const logDir = path.join(rootDir, modulePath, 'target');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logPath = path.join(logDir, 'startup.log');
    const errorLogPath = path.join(logDir, 'startup-error.log');

    // Clear previous logs
    try { fs.writeFileSync(logPath, ''); } catch(e) {}
    try { fs.writeFileSync(errorLogPath, ''); } catch(e) {}

    console.log(`\n   Log files:`);
    console.log(`     stdout: ${path.relative(rootDir, logPath)}`);
    console.log(`     stderr: ${path.relative(rootDir, errorLogPath)}`);

    // Build command
    const mvnCmd = mavenHome || 'mvn';
    const settingsArg = mavenSettings ? `-s "${mavenSettings}"` : '';
    const profileArgs = profiles
        ? `-Dspring-boot.run.profiles="${profiles}"`
        : '';

    // Step 1: Install dependencies first (especially ruoyi-modules/app)
    console.log(`\n   [Step 1/2] Installing dependencies...`);
    const installCmd = `${mvnCmd} install -DskipTests -q ${settingsArg}`;
    console.log(`   Command: ${installCmd}`);

    const { execSync } = require('child_process');
    try {
        execSync(installCmd, {
            shell: true,
            cwd: rootDir,
            stdio: 'inherit'
        });
        console.log(colorize('   [OK] Dependencies installed successfully', 'green'));
    } catch (error) {
        console.error(colorize(`   [WARN] Install command failed, continuing anyway...`, 'yellow'));
    }

    // Step 2: Start Spring Boot application
    console.log(`\n   [Step 2/2] Starting Spring Boot application...`);
    const runCmd = `${mvnCmd} spring-boot:run -f ${modulePath}/pom.xml ${settingsArg} ${profileArgs} -Dspring-boot.run.jvmArguments="${jvmArgs}"`;
    console.log(`   Command: ${runCmd}`);

    // Create log streams
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const errorStream = fs.createWriteStream(errorLogPath, { flags: 'a' });

    // Spawn Maven process
    const mavenProcess = spawn(runCmd, [], {
        shell: true,
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    // Capture stdout -> log file
    mavenProcess.stdout.on('data', (data) => {
        const output = data.toString();
        logStream.write(output);
    });

    // Capture stderr -> both error log and main log (for error detection)
    mavenProcess.stderr.on('data', (data) => {
        const output = data.toString();
        errorStream.write(output);
        logStream.write(output); // Also write to main log for verify-startup detection
    });

    // Handle errors
    mavenProcess.on('error', (err) => {
        console.error(colorize(`   [ERROR] Failed to start process: ${err.message}`, 'red'));
        process.exit(1);
    });

    // Handle exit
    mavenProcess.on('exit', (code) => {
        logStream.end();
        errorStream.end();
        
        if (code !== 0 && code !== null) {
            console.error(colorize(`   [ERROR] Maven exited with code ${code}`, 'red'));
            process.exit(code);
        }
    });

    console.log(colorize('   [OK] Start command sent!', 'green'));
    console.log(`   Maven PID: ${mavenProcess.pid}`);
    console.log('   Application starting in background...\n');

    // Output result as JSON for parent script
    const result = {
        success: true,
        pid: mavenProcess.pid,
        logPath: logPath,
        errorLogPath: errorLogPath
    };
    
    console.log(JSON.stringify(result));
    
    // CRITICAL: Keep this process alive to maintain child process!
    // If we exit, Maven child process may be terminated on Windows
    setInterval(() => {
        // Check if Maven is still alive every 5 seconds
        if (!mavenProcess.killed) {
            return;
        }
        
        // Process died, exit this wrapper
        console.error(colorize('[ERROR] Maven process terminated unexpectedly', 'red'));
        process.exit(1);
    }, 5000);
}

main().catch(err => {
    console.error(colorize(`Fatal error: ${err.message}`, 'red'));
    process.exit(2);
});
