#!/usr/bin/env node

/**
 * restart-module.js v3.0 - Ultra-Fast Application Restarter (Node.js Version)
 * 
 * Features:
 * - Zero-wait phase transitions
 * - Complete error detection and reporting
 * - Async/await for smooth execution
 * - Structured JSON output for integration
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { spawn } = require('child_process');

// Color codes
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
};

function colorize(text, color) {
    return `${colors[color] || ''}${text}${colors.reset}`;
}

// Parse command line arguments
const args = process.argv.slice(2);
let moduleName = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--module' && args[i+1]) {
        moduleName = args[i+1];
        i++;
    }
}

if (!moduleName) {
    console.error(colorize('Error: --module is required (app/business/admin)', 'red'));
    console.error('Usage: node restart-module.js --module <module-name>');
    process.exit(1);
}

// Paths
const scriptDir = __dirname;
// scripts -> app-restarter -> skills -> .trae -> project root (4 levels up)
const rootDir = path.resolve(scriptDir, '..', '..', '..', '..');
const configPath = path.join(scriptDir, '..', 'config.json');

/**
 * Load configuration from config.json
 */
function loadConfig() {
    try {
        const configData = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configData);

        if (!config.modules) {
            return {
                error: 'No modules defined in config.json',
                valid: false,
                availableModules: []
            };
        }

        const availableModules = Object.keys(config.modules);

        if (!moduleName || !config.modules[moduleName]) {
            console.error(colorize(`\nError: Module '${moduleName || ''}' not found in config`, 'red'));
            console.error(colorize('\nAvailable modules:', 'yellow'));
            availableModules.forEach(name => {
                const mod = config.modules[name];
                console.error(`  - ${colorize(name, 'cyan')} (${mod.appName || name})`);
            });
            console.error('');
            return {
                error: `Module '${moduleName}' not found`,
                valid: false,
                availableModules
            };
        }

        return {
            version: config.version,
            module: config.modules[moduleName],
            settings: config.settings,
            valid: true,
            availableModules
        };
    } catch (err) {
        return {
            error: err.message,
            valid: false,
            availableModules: []
        };
    }
}

/**
 * Execute a shell command with Promise
 */
function executeCommand(command, options = {}) {
    return new Promise((resolve, reject) => {
        const child = exec(command, { 
            cwd: rootDir,
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            ...options 
        }, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

/**
 * Sleep function
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Kill process on port using netstat and taskkill
 */
async function killProcessOnPort(port) {
    console.log(`\n[kill-process] Closing process on port ${port}...`);
    
    try {
        // Find process using the port
        const { stdout } = await executeCommand(`netstat -ano | findstr :${port}`);
        const lines = stdout.split('\n').filter(line => line.includes('LISTENING'));
        
        if (lines.length === 0) {
            console.log(`   [INFO] No process found on port ${port}`);
            return { success: true, killedPid: null };
        }

        // Extract PIDs
        const pids = new Set();
        lines.forEach(line => {
            const match = line.match(/\s+(\d+)\s*$/);
            if (match) pids.add(match[1]);
        });

        let killedPid = null;
        for (const pid of pids) {
            console.log(`   Attempt to kill PID ${pid}...`);
            
            try {
                await executeCommand(`taskkill /PID ${pid} /F`);
                console.log(`   ${colorize('[SUCCESS]', 'green')} Process ${pid} terminated`);
                killedPid = pid;
            } catch (err) {
                console.log(`   ${colorize('[WARNING]', 'yellow')} Failed to kill process ${pid}: ${err.error.message}`);
            }
        }

        return { success: true, killedPid };
    } catch (err) {
        console.log(`   ${colorize('[ERROR]', 'red')} Failed to find/kill process: ${err.message}`);
        return { success: false, error: err.message };
    }
}

/**
 * Check if port is released
 */
async function checkPortReleased(port) {
    console.log(`\n[check-port] Checking port ${port}...`);
    
    try {
        const { stdout } = await executeCommand(`netstat -ano | findstr :${port}`);
        const hasListener = stdout.includes('LISTENING');
        
        if (!hasListener) {
            console.log(`   ${colorize('[INFO]', 'cyan')} Port ${port} is FREE`);
            return { released: true };
        } else {
            console.log(`   ${colorize('[WARNING]', 'yellow')} Port ${port} still in use`);
            return { released: false };
        }
    } catch (err) {
        // If command fails, assume port is free
        console.log(`   ${colorize('[INFO]', 'cyan')} Port ${port} is FREE (assumed)`);
        return { released: true };
    }
}

/**
 * Start application via Maven
 */
async function startApplication(moduleConfig, settings) {
    const { appName, modulePath, port, profiles, mavenProfile, jvmArgs, startupMode, dependencies } = moduleConfig;

    console.log('\n[start-app] Starting application via Maven');
    console.log('='.repeat(50));
    console.log(`   Module: ${modulePath}`);
    console.log(`   Port: ${port}`);
    console.log(`   Profile: ${profiles}`);
    console.log(`   JVM Args: ${jvmArgs}`);
    if (dependencies && dependencies.length > 0) {
        console.log(`   Dependencies: ${dependencies.join(', ')}`);
    }

    // Log file paths
    const logDir = path.join(rootDir, modulePath, 'target');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logPath = path.join(logDir, 'startup.log');
    const errorLogPath = path.join(logDir, 'startup-error.log');

    console.log(`\n   Log files:`);
    console.log(`     stdout: ${path.relative(rootDir, logPath)}`);
    console.log(`     stderr: ${path.relative(rootDir, errorLogPath)}`);

    // Build Maven command (matching PS1 script exactly)
    const mavenCmd = settings.mavenHome || 'mvn';
    const mavenSettings = settings.mavenSettings ? `-s "${settings.mavenSettings}"` : '';
    // Use mavenProfile from config (already destructured at line 181)
    const springProfiles = `-Dspring-boot.run.profiles="${profiles}"`;

    // Set MAVEN_OPTS (matches PS1: $env:MAVEN_OPTS = "-Dmaven.repo.local=...")
    if (!settings.mavenRepo) {
        console.log(colorize('   [WARNING] mavenRepo not configured in config.json', 'yellow'));
        console.log('   Maven will use default repository location');
    }
    const mavenRepo = settings.mavenRepo;
    if (mavenRepo) {
        process.env.MAVEN_OPTS = `-Dmaven.repo.local=${mavenRepo}`;
    }

    // Force Maven to use UTF-8 encoding for all output (fixes Chinese character encoding issues)
    // Use JAVA_TOOL_OPTIONS environment variable to ensure UTF-8 encoding
    process.env.JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8';

    // Step 1: Install declared dependencies (only the modules specified in config)
    if (dependencies && dependencies.length > 0) {
        console.log(`\n   [Step 1/2] Installing dependencies: ${dependencies.join(', ')}...`);
        const { execSync } = require('child_process');

        for (const dep of dependencies) {
            const depPath = path.join(rootDir, dep, 'pom.xml');
            const installCmd = `${mavenCmd} install -DskipTests -q -f "${depPath}" ${mavenSettings}`;
            console.log(`   Installing: ${dep}`);
            console.log(`   Command: ${installCmd}`);

            try {
                execSync(installCmd, {
                    shell: true,
                    cwd: rootDir,
                    stdio: 'inherit',
                    env: process.env
                });
                console.log(colorize(`   [OK] ${dep} installed`, 'green'));
            } catch (error) {
                console.error(colorize(`   [WARN] ${dep} install failed, continuing...`, 'yellow'));
            }
        }
        console.log(colorize('   [OK] All dependencies installed', 'green'));
    } else {
        console.log(`\n   [Step 1/2] No dependencies to install`);
    }

    // Step 2: Start Spring Boot application
    console.log(`\n   [Step 2/2] Starting Spring Boot application...`);

    // CRITICAL: Use -P to activate Maven profile (enables @...@ resource filtering)
    // Also add -DskipTests=true for faster startup (matches PS1 behavior)
    // Force Maven to use UTF-8 encoding for all output (fixes Chinese character encoding issues)
    const cmd = `${mavenCmd} spring-boot:run -f ${modulePath}/pom.xml ${mavenSettings} -P "${mavenProfile}" ${springProfiles} -Dspring-boot.run.jvmArguments="-Xms512m -Xmx1024m -Dfile.encoding=UTF-8" -DskipTests=true -Dproject.build.sourceEncoding=UTF-8 -Dmaven.compiler.encoding=UTF-8`;

    console.log(`\n   Sending Maven start command...`);
    console.log(`   [INFO] Using Maven profile: -P ${mavenProfile} (for resource filtering)`);

    // Start Maven in background
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });
    const errorLogStream = fs.createWriteStream(errorLogPath, { flags: 'w' });

    const mavenProcess = spawn(cmd, [], {
        shell: true,
        cwd: rootDir,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env // Inherit environment with MAVEN_OPTS and encoding settings
    });

    // Capture output
    mavenProcess.stdout.on('data', (data) => {
        const output = data.toString();
        logStream.write(output);
    });

    mavenProcess.stderr.on('data', (data) => {
        const output = data.toString();
        errorLogStream.write(output);
        // Also write errors to main log for detection
        logStream.write(output);
    });

    mavenProcess.on('error', (err) => {
        console.error(`   ${colorize('[ERROR]', 'red')} Maven process error: ${err.message}`);
    });

    console.log(`   ${colorize('[OK]', 'green')} Start command sent!`);
    console.log(`   Maven PID: ${mavenProcess.pid}`);
    console.log('   Application starting in background...\n');
    
    // DEBUG: Log the actual command for troubleshooting
    if (process.env.DEBUG === 'true') {
        console.log(`   [DEBUG] Command: ${cmd}`);
        console.log(`   [DEBUG] Working dir: ${rootDir}`);
    }

    return {
        success: true,
        pid: mavenProcess.pid,
        logPath: logPath,
        errorLogPath: errorLogPath,
        process: mavenProcess
    };
}

/**
 * Verify startup by calling verify-startup.js
 */
async function verifyStartup(port, logPath, errorLogPath, timeout) {
    const verifyScript = path.join(scriptDir, 'verify-startup.js');
    
    console.log(`[Step 5/5] Verifying startup (timeout: ${timeout}s)...`);

    return new Promise((resolve) => {
        const verifyProcess = spawn('node', [
            verifyScript,
            '--port', String(port),
            '--max-wait', String(timeout),
            '--log-path', logPath,
            '--error-log-path', errorLogPath
        ], {
            cwd: rootDir,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        verifyProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            process.stdout.write(output); // Stream output to console
        });

        verifyProcess.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            process.stderr.write(output); // Stream errors to console
        });

        verifyProcess.on('close', (code) => {
            // Try to parse JSON result from last lines
            const lines = stdout.trim().split('\n');
            const jsonLine = lines.find(line => line.trim().startsWith('{'));
            
            let result;
            try {
                result = jsonLine ? JSON.parse(jsonLine) : null;
            } catch (e) {
                result = null;
            }

            resolve({
                exitCode: code,
                result: result,
                rawOutput: stdout,
                errorOutput: stderr
            });
        });

        verifyProcess.on('error', (err) => {
            resolve({
                exitCode: -1,
                result: null,
                rawOutput: '',
                errorOutput: err.message
            });
        });
    });
}

/**
 * Generate execution report
 */
function generateReport(moduleConfig, startTime, status, verifyResult) {
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log(colorize('         Execution Report v3.0', 'cyan'));
    console.log('='.repeat(60));
    console.log(`Module   : ${moduleConfig.appName}`);
    console.log(`Port     : ${moduleConfig.port}`);
    console.log(`Profile  : ${moduleConfig.profiles}`);
    console.log(`Duration : ${duration}s`);
    
    if (status === 'SUCCESS') {
        console.log(`Status   : ${colorize('SUCCESS', 'green')}`);
        if (verifyResult && verifyResult.result) {
            console.log(`PID      : ${verifyResult.result.pid}`);
        }
    } else {
        console.log(`Status   : ${colorize(status, 'red')}`);
        console.log(`Error    : ${verifyResult?.result?.error || 'UNKNOWN'}`);
    }
    
    console.log(`Time     : ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`);
    console.log('='.repeat(60));

    return {
        moduleName: moduleConfig.appName,
        port: moduleConfig.port,
        profile: moduleConfig.profiles,
        duration: parseFloat(duration),
        status: status,
        timestamp: new Date().toISOString(),
        details: verifyResult?.result || null
    };
}

/**
 * Main execution function
 */
async function main() {
    const startTime = Date.now();

    console.log('');
    console.log('='.repeat(50));
    console.log(colorize('   App Restarter v3.0 - Ultra-Fast', 'cyan'));
    console.log(colorize('   (Zero-Wait & Complete Error Detection)', 'gray'));
    console.log('='.repeat(50));

    // Step 1: Load configuration
    console.log(`\n[${new Date().toTimeString().substring(0,8)}] [Step 1/5] Loading config...`);
    
    const config = loadConfig();
    if (!config.valid) {
        console.error(colorize(`[ERROR] Config loading failed: ${config.error}`, 'red'));
        process.exit(1);
    }

    console.log(colorize(`[OK] Config loaded (${config.version})`, 'green'));

    const { module: moduleConfig, settings } = config;
    
    console.log(`\n[Module Configuration]`);
    console.log(`   Name:     ${moduleConfig.appName}`);
    console.log(`   Port:     ${moduleConfig.port}`);
    console.log(`   Profile:  ${moduleConfig.profiles}`);
    console.log(`   Timeout:  ${(settings.startupTimeout / 1000)}s`);

    // Step 2: Kill existing process
    console.log(`\n[${new Date().toTimeString().substring(0,8)}] [Step 2/5] Killing process on port ${moduleConfig.port}...`);
    
    await killProcessOnPort(moduleConfig.port);

    // Minimal wait after close (max 1 second)
    const waitAfterCloseMs = Math.min(settings.waitAfterClose * 1000 || 2000, 1000);
    if (waitAfterCloseMs > 0) {
        await sleep(waitAfterCloseMs);
    }

    // Step 3: Verify port release
    console.log(`\n[${new Date().toTimeString().substring(0,8)}] [Step 3/5] Verifying port release...`);
    
    await checkPortReleased(moduleConfig.port);

    // Step 4: Start application
    console.log(`\n[${new Date().toTimeString().substring(0,8)}] [Step 4/5] Starting application...`);
    
    const startResult = await startApplication(moduleConfig, settings);
    if (!startResult.success) {
        generateReport(moduleConfig, startTime, 'START_FAILED', null);
        process.exit(1);
    }

    // Step 5: Verify startup (immediate transition)
    console.log(`\n[${new Date().toTimeString().substring(0,8)}] [Step 5/5] Verifying startup (timeout: ${(settings.startupTimeout / 1000)}s)...`);
    
    const verifyResult = await verifyStartup(
        moduleConfig.port,
        startResult.logPath,
        startResult.errorLogPath,
        settings.startupTimeout / 1000
    );

    // Generate final report
    let finalStatus;
    if (verifyResult.exitCode === 0) {
        finalStatus = 'SUCCESS';
        console.log('\n' + colorize('[COMPLETE] Restart completed successfully!', 'green'));
    } else {
        finalStatus = verifyResult.result?.error || 'FAILED';
        console.log('\n' + colorize('[INCOMPLETE] Restart did not complete.', 'red'));
        if (verifyResult.result?.suggestion) {
            console.log(colorize(`\n[Suggestion] ${verifyResult.result.suggestion}`, 'yellow'));
        }
    }

    const report = generateReport(moduleConfig, startTime, finalStatus, verifyResult);

    // Save report to file (optional)
    const reportPath = path.join(rootDir, '.trae', 'skills', 'app-restarter', 'last-report.json');
    try {
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n[Diagnostics] Report saved to: ${reportPath}`);
    } catch (e) {
        // Ignore save errors
    }

    // Exit with appropriate code
    process.exit(finalStatus === 'SUCCESS' ? 0 : 1);
}

// Run main function
main().catch(err => {
    console.error(colorize(`\n[FATAL ERROR] ${err.message}`, 'red'));
    console.error(err.stack);
    process.exit(2);
});
