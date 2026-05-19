---
name: "app-restarter"
description: "Ultra-fast application restart tool for multi-module Maven projects. Automatically detects code modifications and restarts the corresponding Spring Boot application module with complete error detection."
---

# App Restarter Skill v3.1 (Node.js Edition)

**Ultra-fast automatic application restart detection and execution for multi-module Maven projects.**

## Overview

This skill automatically detects code modifications and restarts the corresponding Spring Boot application module with **zero-wait phase transitions** and **complete error detection**.

## 🆕 v3.1 - Auto File Watcher

**NEW: Real-time file monitoring with automatic restart!**

The watcher monitors Java file changes and automatically triggers module restart:
- Real-time detection of `.java` file modifications
- Debounce mechanism (2s) prevents rapid restarts
- Module auto-detection based on file path
- Works independently in background

### Start Auto-Watcher

```bash
# Watch all modules (app, business, admin)
node .\.trae\skills\app-restarter\scripts\watcher.js

# Watch specific modules only
node .\.trae\skills\app-restarter\scripts\watcher.js admin
node .\.trae\skills\app-restarter\scripts\watcher.js app business
```

Press `Ctrl+C` to stop the watcher.

### 🚀 v3.0 Key Improvements

- ✅ **Migrated to Node.js** - Stable, cross-platform, no PowerShell syntax issues
- ⚡ **Zero-wait execution** - Seamless phase transitions, no artificial delays
- 🔍 **Complete error detection** - 6 types of errors (compilation, runtime, etc.)
- 📊 **Structured JSON output** - Easy integration and parsing
- 🎨 **Colorful console output** - Clear status visualization
- 🛡️ **Robust error handling** - Promise-based async/await patterns

## Quick Start

### One-Command Restart (Recommended)

```bash
# Restart admin module
node .\.trae\skills\app-restarter\scripts\restart-module.js --module admin

# Restart business module
node .\.trae\skills\app-restarter\scripts\restart-module.js --module business

# Restart app (user mobile) module
node .\.trae\skills\app-restarter\scripts\restart-module.js --module app
```

### Individual Script Usage

All scripts are located in `.trae/skills/app-restarter/scripts/`:

| Script | Purpose | Usage Example |
|--------|---------|---------------|
| `restart-module.js` | **Main controller** - Full restart workflow | `node restart-module.js --module admin` |
| `kill-process.js` | Kill process on port with retry | `node kill-process.js --port 9003` |
| `check-port.js` | Check port status | `node check-port.js --port 9003` |
| `start-app.js` | Start app via Maven | `node start-app.js --module cereshop-admin --port 9003` |
| `verify-startup.js` | Verify app is running & detect errors | `node verify-startup.js --port 9003 --log-path target/startup.log` |

## Configuration

Edit `.trae/skills/app-restarter/config.json` to customize settings:

```json
{
  "version": "3.0",
  "modules": {
    "admin": {
      "appName": "Admin PC Interface",
      "modulePath": "cereshop-admin",
      "port": 9003,
      "profiles": "admin-dev,security",
      "mavenProfile": "admin-dev",
      "jvmArgs": "-Xms512m -Xmx1024m",
      "startupMode": "maven"
    }
  },
  "settings": {
    "useCommandLine": true,
    "mavenHome": "C:\\Users\\Administrator\\AppData\\Roaming\\JetBrains\\IntelliJIdea2025.3\\plugins\\maven\\lib\\maven3\\bin\\mvn.cmd",
    "mavenSettings": "D:\\Tool\\maven\\settings.xml",
    "waitAfterClose": 1,
    "startupTimeout": 45000
  }
}
```

### Module Configuration Fields

| Field | Description | Example |
|-------|-------------|---------|
| `appName` | Display name | `"Admin PC Interface"` |
| `modulePath` | Maven module path | `"cereshop-admin"` |
| `port` | Application port | `9003` |
| `profiles` | Spring profiles (comma-separated) | `"admin-dev,security"` |
| `mavenProfile` | Maven profile ID | `"admin-dev"` |
| `jvmArgs` | JVM parameters | `"-Xms512m -Xmx1024m"` |
| `startupMode` | Startup mode (`"maven"` or `"idea"`) | `"maven"` |

## Workflow

The main controller (`restart-module.js`) executes these steps in order with **zero-wait transitions**:

```
Step 1: Load Configuration
   ↓ [immediate]
Step 2: Kill Old Process (on target port)
   ↓ [max 1s wait]
Step 3: Verify Port Release
   ↓ [immediate]
Step 4: Start New Application (via Maven)
   ↓ [immediate]
Step 5: Verify Startup Success (with complete error detection)
   ↓
[SUCCESS] ✓ or [INCOMPLETE] ✗ (with detailed error report)
```

## Error Detection System

The verification script (`verify-startup.js`) detects **6 types of errors**:

| Error Type | Pattern | Detection Method |
|------------|---------|------------------|
| **COMPILATION_ERROR** | `[ERROR] COMPILATION ERROR` | Syntax/code errors in Java files |
| **SPRING_BOOT_STARTUP_FAILURE** | `APPLICATION FAILED TO START` | Spring Boot initialization failure |
| **BEAN_CREATION_FAILURE** | `BeanCreationException/UnsatisfiedDependencyException` | Dependency injection errors |
| **DATABASE_ERROR** | `Cannot create PoolableConnectionFactory` | Database connection failures |
| **CONFIGURATION_ERROR** | `BindingException/ConfigurationPropertiesBindException` | Configuration binding errors |
| **PORT_CONFLICT** | `Address already in use` | Port already occupied |

### Error Output Format

When an error is detected, the script outputs structured JSON:

```json
{
  "success": false,
  "error": "COMPILATION_ERROR",
  "port": 9003,
  "elapsedSeconds": 12.34,
  "errorDetail": "[COMPILATION ERRORS] - Syntax/Code Errors:\n[ERROR] /path/to/file.java:[line] error message",
  "suggestion": "Fix syntax errors shown above and re-run",
  "timestamp": "2026-04-07T03:15:00.000Z"
}
```

## Performance Features

### Zero-Wait Phase Transitions

- **No artificial delays** between phases
- **Adaptive interval algorithm** for startup checking:
  - Maven Init phase: 1s intervals
  - Compiling phase: 2s intervals (longer compilation time)
  - Spring Boot phase: 1s intervals
  - Database/Redis phases: 1s intervals
- **Immediate error termination**: As soon as error detected, stop and report

### Ultra-Fast Port Checking

Uses Node.js `net` module for instant port availability checks (faster than netstat).

## Troubleshooting

### Common Issues

1. **Port already in use**: The kill script will attempt up to 3 retries with force kill (`taskkill /F`)
2. **Maven not found**: Check `mavenHome` path in config.json
3. **Startup timeout**: Increase `startupTimeout` in config.json (default: 45s)
4. **Node.js not found**: Ensure Node.js v14+ is installed and in PATH
5. **Compilation errors**: Check `target/startup.log` and `target/startup-error.log`

### Log Files

After startup, check these log files for debugging:
- `{module}/target/startup.log` - Combined stdout + stderr (for error detection)
- `{module}/target/startup-error.log` - Error-only output

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - Application started successfully |
| 1 | Failure - Error detected or timeout |
| 2 | Fatal - Script execution exception |

## Architecture

```
.app-restarter/
├── config.json              # Module configuration (JSON format)
├── SKILL.md                 # This documentation
└── scripts/
    ├── restart-module.js    # Main controller (calls all others)
    ├── kill-process.js      # Port process termination
    ├── check-port.js        # Port status checker (using net module)
    ├── start-app.js         # Maven application starter
    └── verify-startup.js    # Startup verification with error detection
```

## Migration from PowerShell (v2.x)

If you're upgrading from the PowerShell version (v2.x):

✅ **What Changed:**
- All `.ps1` scripts replaced with `.js` equivalents
- Command syntax changed (see usage examples above)
- JSON output now guaranteed (no text parsing needed)
- Better error messages and suggestions

❌ **No Longer Needed:**
- PowerShell 5.1 compatibility workarounds
- Manual stderr/stdout merging
- Complex string escaping issues

🔄 **Migration Steps:**
1. Replace all calls from `powershell -File script.ps1` to `node script.js`
2. Update arguments format (use `--arg value` instead of `-Arg value`)
3. Parse JSON output instead of text parsing
4. Remove any PowerShell-specific environment setup

## Version History

- **v3.0** - Complete rewrite in Node.js, zero-wait design, complete error detection
- **v2.2** - PowerShell optimization attempt (abandoned due to syntax issues)
- **v2.0** - Command-line mode with modular scripts, custom JVM support
- **v1.0** - Initial IDEA MCP-based implementation (deprecated)

## Requirements

- **Node.js** v14+ (tested on v24.9.0)
- **npm** (included with Node.js)
- **Maven** (configured via `config.json`)
- **Windows OS** (uses `netstat`, `taskkill`, `net` commands)
