#!/usr/bin/env node

/**
 * verify-startup.js v3.1 - Instant Response Mode
 * 
 * 🚀 Core Philosophy: ZERO WAIT, IMMEDIATE RESPONSE
 * 
 * Features:
 * - Error detected → STOP immediately (0ms delay)
 * - App started → RETURN success immediately  
 * - Process died → CHECK result immediately
 * - No progress for 10s → FAST FAIL (don't wait 45s)
 * 
 * Detection Types:
 * 1. COMPILATION_ERROR - Syntax/Code errors
 * 2. SPRING_BOOT_STARTUP_FAILURE - Application init failure
 * 3. BEAN_CREATION_FAILURE - Dependency injection errors
 * 4. DATABASE_ERROR - Database connection failures
 * 5. CONFIGURATION_ERROR - Configuration binding errors
 * 6. PORT_CONFLICT - Port already in use
 */

const fs = require('fs');
const net = require('net');
const { exec } = require('child_process');

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

// Parse arguments
const args = process.argv.slice(2);
let port = null;
let maxWaitSeconds = 45;
let checkIntervalMs = 500; // Check every 500ms (ultra-fast)
let logPath = null;
let errorLogPath = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i+1]) { port = parseInt(args[++i]); }
    if (args[i] === '--max-wait' && args[i+1]) { maxWaitSeconds = parseInt(args[++i]); }
    if (args[i] === '--interval' && args[i+1]) { checkIntervalMs = parseInt(args[++i]); }
    if (args[i] === '--log-path' && args[i+1]) { logPath = args[++i]; }
    if (args[i] === '--error-log-path' && args[i+1]) { errorLogPath = args[++i]; }
}

if (!port) {
    console.error(colorize('Error: --port is required', 'red'));
    process.exit(1);
}

/**
 * Read log file tail (optimized)
 * Maven outputs in UTF-8 encoding (forced by -Dfile.encoding=UTF-8)
 */
function readLogTail(filePath, lines = 100) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return null;
        const content = fs.readFileSync(filePath, 'utf-8');
        return content.split('\n').slice(-lines);
    } catch (e) {
        return null;
    }
}

/**
 * Find last non-empty line from log content
 */
function findLastNonEmptyLine(logContent) {
    if (!logContent || logContent.length === 0) return '';
    for (let i = logContent.length - 1; i >= 0; i--) {
        if (logContent[i] && logContent[i].trim()) return logContent[i];
    }
    return '';
}

/**
 * Detect startup phase with instant error detection
 */
function detectStartupPhase(logContent, currentPhase) {
    if (!logContent || logContent.length === 0) {
        return { phase: 'Initializing', detail: 'Reading log...', hasError: false, errorDetail: null, errorType: null };
    }

    const lastLine = findLastNonEmptyLine(logContent);
    if (!lastLine) {
        return { phase: 'Initializing', detail: 'Empty log...', hasError: false, errorDetail: null, errorType: null };
    }

    // Check last 10 lines for phase detection (more reliable than just last line)
    const recentLines = logContent.slice(-10).filter(line => line && line.trim());
    const recentText = recentLines.join('\n');

    // Phase detection (check recent lines for more reliability)
    if (/Scanning for projects/.test(recentText)) {
        return { phase: 'Maven Init', detail: 'Scanning project structure', hasError: false, errorDetail: null, errorType: null };
    }
    
    if (/Compiling \d+ source files/.test(recentText)) {
        return { phase: 'Compiling', detail: 'Compiling source files...', hasError: false, errorDetail: null, errorType: null };
    }
    
    if (/Starting Cereshop\w+Application/.test(recentText)) {
        return { phase: 'Spring Boot', detail: 'Application initializing', hasError: false, errorDetail: null, errorType: null };
    }
    
    if (/Started \w+ in [\d.]+ seconds/.test(recentText)) {
        return { phase: 'Started', detail: 'Application ready!', hasError: false, errorDetail: null, errorType: null };
    }
    
    if (/HikariPool|DataSource/.test(recentText)) {
        return { phase: 'Database', detail: 'Connecting to database', hasError: false, errorDetail: null, errorType: null };
    }
    
    if (/Redisson|Redis/.test(recentText)) {
        return { phase: 'Redis', detail: 'Connecting to Redis', hasError: false, errorDetail: null, errorType: null };
    }
    
    // ERROR DETECTION - Check last 30 lines for any [ERROR] or [FATAL]
    const errorCheckLines = logContent.slice(-30).filter(line => line && line.trim());
    const hasErrorInRecent = errorCheckLines.some(line => /\[ERROR\]|\[FATAL\]/.test(line));
    
    if (hasErrorInRecent) {
        const errorInfo = extractCompleteErrorDetails(logContent, errorLogPath);
        return { 
            phase: 'ERROR', 
            detail: 'Error detected!', 
            hasError: true, 
            errorDetail: errorInfo.details, 
            errorType: errorInfo.type 
        };
    }

    return { phase: currentPhase, detail: null, hasError: false, errorDetail: null, errorType: null };
}

/**
 * Extract complete error details (6 types)
 */
function extractCompleteErrorDetails(logContent, errLogPath) {
    const errorLines = [];
    let errorType = 'UNKNOWN';
    let inErrorBlock = false;
    let foundDetailedErrors = false;

    for (let i = 0; i < logContent.length; i++) {
        const line = logContent[i];

        // Handle compilation error block first
        if (inErrorBlock) {
            if (/^\[INFO\] \d+ errors?/.test(line)) {
                errorLines.push(line);
                inErrorBlock = false;
            } else if (/\[ERROR\]/.test(line)) {
                errorLines.push(line);
            }
            continue;
        }

        // Detect different error types
        if (/\[ERROR\].*COMPILATION ERROR/.test(line)) {
            inErrorBlock = true;
            foundDetailedErrors = true;
            errorType = 'COMPILATION_ERROR';
            errorLines.push('='.repeat(60));
            errorLines.push('[COMPILATION ERRORS] - Syntax/Code Errors:');
            errorLines.push('='.repeat(60));
        } else if (/APPLICATION FAILED TO START|Application run failed/.test(line)) {
            if (!foundDetailedErrors) {
                errorType = 'SPRING_BOOT_STARTUP_FAILURE';
            }
            errorLines.push('');
            errorLines.push('='.repeat(60));
            errorLines.push('[SPRING BOOT STARTUP FAILURE]');
            errorLines.push('='.repeat(60));
            errorLines.push(line);
        } else if (/BeanCreationException|UnsatisfiedDependencyException|NoSuchBeanDefinitionException/.test(line)) {
            if (!foundDetailedErrors) errorType = 'BEAN_CREATION_FAILURE';
            errorLines.push('[BEAN CREATION FAILURE] ');
            errorLines.push(line);
        } else if (/Cannot create PoolableConnectionFactory|CommunicationsException|Connection refused|DataSource/.test(line)) {
            if (!foundDetailedErrors) errorType = 'DATABASE_ERROR';
            errorLines.push('[DATABASE ERROR] ');
            errorLines.push(line);
        } else if (
            /BindingException|ConfigurationPropertiesBindException|InvalidPropertyException|ScannerException|ParserException|YAML/.test(line)
        ) {
            if (!foundDetailedErrors) errorType = 'CONFIGURATION_ERROR';
            errorLines.push('[CONFIG ERROR] ');
            errorLines.push(line);
        } else if (/Address already in use|Port.*already in use|bind.*failed/.test(line)) {
            if (!foundDetailedErrors) errorType = 'PORT_CONFLICT';
            errorLines.push('[PORT CONFLICT] ');
            errorLines.push(line);
        } else if (/BUILD FAILURE|Application finished with exit code/.test(line) && !foundDetailedErrors) {
            errorLines.push('');
            errorLines.push('[BUILD FAILED] - Application failed to start');
            errorLines.push(line);
        }
    }

    // If no detailed errors found, extract last errors
    if (!foundDetailedErrors && errorLines.length === 0) {
        const allErrors = logContent.filter(line => 
            /\[ERROR\]|Exception|FAILED/.test(line)
        ).slice(-10);
        
        if (allErrors.length > 0) {
            errorLines.push('', '[RUNTIME ERRORS]', '-'.repeat(60), ...allErrors);
            errorType = 'RUNTIME_EXCEPTION';
        }
    }

    // Read stderr log
    if (errLogPath && fs.existsSync(errLogPath)) {
        try {
            const stderrContent = fs.readFileSync(errLogPath, 'utf-8').split('\n').slice(-30);
            if (stderrContent.some(line => line.trim())) {
                errorLines.push('', '[STDERR OUTPUT]:', '-'.repeat(40), ...stderrContent.filter(l => l.trim()));
            }
        } catch (e) {}
    }

    return { details: errorLines.join('\n'), type: errorType };
}

/**
 * Get error suggestion
 */
function getErrorSuggestion(errorType) {
    const suggestions = {
        COMPILATION_ERROR: 'Fix syntax errors shown above and re-run',
        SPRING_BOOT_STARTUP_FAILURE: 'Check initialization errors (database, beans, config)',
        BEAN_CREATION_FAILURE: 'Fix dependency injection issues',
        DATABASE_ERROR: 'Verify database server is running',
        PORT_CONFLICT: 'Stop conflicting process or change port',
        CONFIGURATION_ERROR: 'Check configuration properties'
    };
    return suggestions[errorType] || 'Check error details above';
}

/**
 * Check port status using net module (fastest method)
 */
function checkPortFast(portNum) {
    return new Promise((resolve) => {
        const server = net.createServer();
        let resolved = false;
        
        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                try { server.close(); } catch(e) {}
            }
        };
        
        server.once('error', (err) => {
            cleanup();
            if (err.code === 'EADDRINUSE') {
                resolve(true);  // Port is in use
            } else {
                resolve(false);  // Other error, assume port is free
            }
        });
        
        server.once('listening', () => {
            cleanup();
            resolve(false);  // Port is free
        });
        
        // Try to listen on the port
        server.listen(portNum);
        
        // Timeout after 200ms to avoid hanging
        setTimeout(() => {
            if (!resolved) {
                cleanup();
                // If timeout, check using netstat as fallback
                exec(`netstat -ano | findstr :${portNum} | findstr LISTENING`, (err, stdout) => {
                    resolve(!err && stdout.trim().length > 0);
                });
            }
        }, 200);
    });
}

/**
 * Get PID of process listening on port
 */
async function getPortPid(portNum) {
    return new Promise((resolve) => {
        exec(`netstat -ano | findstr :${portNum} | findstr LISTENING`, (err, stdout) => {
            if (err || !stdout.trim()) { resolve(null); return; }
            
            const match = stdout.match(/\s+(\d+)\s*$/);
            resolve(match ? parseInt(match[1]) : null);
        });
    });
}

/**
 * Sleep utility
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * MAIN VERIFICATION FUNCTION - INSTANT RESPONSE MODE
 */
async function verifyStartup() {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`\n${colorize(`[${timestamp}] [verify-startup v3.1] Instant Response Mode`, 'cyan')}`);
    console.log(`   Target port: ${port}`);
    console.log(`   Max wait: ${maxWaitSeconds}s | Check interval: ${checkIntervalMs}ms`);
    console.log(`   Strategy: ZERO-WAIT - Immediate response on any status change\n`);

    const startTime = Date.now();
    let lastPhase = '';
    let lastLogSize = 0;
    let lastLogModTime = 0; // Track log file modification time
    let initialLogModTime = 0; // Log mod time when we started
    const STALL_TIMEOUT_MS = 10000; // 10 seconds without progress = fast fail
    
    // Get initial log modification time (if file exists)
    try {
        if (logPath && fs.existsSync(logPath)) {
            const stat = fs.statSync(logPath);
            initialLogModTime = stat.mtimeMs;
            lastLogModTime = stat.mtimeMs;
        }
    } catch(e) {}
    
    while (true) {
        const elapsed = Date.now() - startTime;
        
        // Check timeout
        if (elapsed >= maxWaitSeconds * 1000) {
            console.log(colorize(`\n[TIMEOUT] ${maxWaitSeconds}s elapsed`, 'yellow'));
            outputResult({
                success: false,
                error: 'TIMEOUT',
                elapsedSeconds: (elapsed / 1000).toFixed(2),
                message: `Timeout after ${maxWaitSeconds}s`,
                suggestion: 'Application may be stuck or taking too long'
            }, 1);
        }

        // Read log and detect phase
        const logContent = readLogTail(logPath);
        const phaseInfo = detectStartupPhase(logContent, lastPhase);

        // Track log changes using modification time (more reliable than size)
        let currentLogModTime = lastLogModTime;
        try {
            if (logPath && fs.existsSync(logPath)) {
                const stat = fs.statSync(logPath);
                currentLogModTime = stat.mtimeMs;
            }
        } catch(e) {}
        
        const currentLogSize = logContent ? logContent.length : 0;
        
        // Log updated?
        if (currentLogModTime !== lastLogModTime) {
            lastLogModTime = currentLogModTime;
            lastLogSize = currentLogSize;
        }

        // Phase changed? Log it
        if (phaseInfo.phase && phaseInfo.phase !== lastPhase) {
            lastPhase = phaseInfo.phase;
            const elapsedSec = (elapsed / 1000).toFixed(1);
            
            let color = 'white';
            switch(phaseInfo.phase) {
                case 'Maven Init': color = 'gray'; break;
                case 'Compiling': color = 'yellow'; break;
                case 'Spring Boot': color = 'cyan'; break;
                case 'Database': color = 'green'; break;
                case 'Redis': color = 'magenta'; break;
                case 'Started': color = 'green'; break;
                case 'ERROR': color = 'red'; break;
            }
            
            console.log(`   [${elapsedSec}s] ${colorize(phaseInfo.phase, color)}${phaseInfo.detail ? ` - ${phaseInfo.detail}` : ''}`);
        }

        // ✅ ERROR DETECTED → STOP IMMEDIATELY
        if (phaseInfo.hasError) {
            console.log(`\n${colorize('[❌ ERROR DETECTED] Stopping immediately!', 'red')}`);
            console.log(`   Type: ${colorize(phaseInfo.errorType, 'yellow')}`);
            console.log(`   Time: ${(elapsed / 1000).toFixed(2)}s`);
            console.log(colorize('\n   Details:', 'yellow'));
            console.log(colorize(phaseInfo.errorDetail || '(No details)', 'red'));
            
            outputResult({
                success: false,
                error: phaseInfo.errorType,
                elapsedSeconds: (elapsed / 1000).toFixed(2),
                lastPhase: 'ERROR',
                errorDetail: phaseInfo.errorDetail,
                message: `${phaseInfo.errorType} detected`,
                suggestion: getErrorSuggestion(phaseInfo.errorType)
            }, 1);
        }

        // ✅ PORT LISTENING → SUCCESS IMMEDIATELY
        const portInUse = await checkPortFast(port);
        if (portInUse) {
            const pid = await getPortPid(port);
            const elapsedSec = (elapsed / 1000).toFixed(2);
            
            console.log(`\n${colorize('[✅ SUCCESS] Application started!', 'green')}`);
            console.log(`   Port: ${port} | PID: ${pid || 'unknown'} | Time: ${elapsedSec}s`);
            
            outputResult({
                success: true,
                port: port,
                pid: pid,
                elapsedSeconds: parseFloat(elapsedSec),
                message: 'Application started successfully'
            }, 0);
        }

        // ⚠️ STALL DETECTION - No progress for 10 seconds (or 15s total if no phase detected)
        // Skip stall detection if application has already started (detected by "Started" phase)
        const timeSinceLogUpdate = Date.now() - lastLogModTime;
        const shouldStallCheck = (
            lastPhase !== 'Started' &&  // Don't check stall if already started
            (
                (timeSinceLogUpdate > STALL_TIMEOUT_MS && lastPhase !== '') ||  // Phase detected but stalled
                (elapsed > 15000 && lastLogModTime === initialLogModTime)  // 15s passed with no log changes = Maven not writing
            )
        );
        
        if (shouldStallCheck) {
            console.log(`\n${colorize(`[⚠️ NO PROGRESS] No log updates for ${(timeSinceLogUpdate/1000).toFixed(1)}s`, 'yellow')}`);
            console.log(`   Elapsed: ${(elapsed/1000).toFixed(1)}s | Last phase: ${lastPhase || '(none)'}`);
            console.log(`   Possible causes:`);
            console.log(`     - Maven process crashed/died`);
            console.log(`     - Compilation stuck (very large project)`);
            console.log(`     - Application hung during startup`);
            console.log(`     - Log file path incorrect or permissions issue`);
            
            outputResult({
                success: false,
                error: 'NO_PROGRESS',
                elapsedSeconds: (elapsed / 1000).toFixed(2),
                lastPhase: lastPhase,
                message: `No log updates for ${(timeSinceLogUpdate/1000).toFixed(1)}s`,
                suggestion: 'Check if Maven process is still running'
            }, 1);
        }

        // Wait before next check (fast interval)
        await sleep(checkIntervalMs);
    }
}

/**
 * Output JSON result and exit
 */
function outputResult(result, exitCode) {
    console.log('\n' + JSON.stringify(result, null, 2));
    process.exit(exitCode);
}

// Run
verifyStartup().catch(err => {
    console.error(colorize(`\n[FATAL] ${err.message}`, 'red'));
    process.exit(2);
});
