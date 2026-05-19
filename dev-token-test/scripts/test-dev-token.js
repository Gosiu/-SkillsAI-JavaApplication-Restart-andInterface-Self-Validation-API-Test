#!/usr/bin/env node
/**
 * Dev Token Test Suite v3.5.0
 *
 * 开发环境Token获取与接口测试工具
 * - 自动获取 System/App 模块的 Token
 * - 使用获取的 Token 进行任意接口测试
 * - 接口报错时自动读取日志获取详细信息
 * - 测试报告自动生成为 md 文件
 * - 批量测试文件强制在 batch-tests 目录中
 * - 报告保留最近10个，自动清理旧文件
 *
 * 支持多模块多端口测试，配置从 app-restarter/config.json 读取
 *
 * 运行方式:
 *   node test-dev-token.js --list                                  # 列出所有已配置模块
 *   node test-dev-token.js --module app                            # 测试 Token 获取流程
 *   node test-dev-token.js --test GET /admin/test/hello            # 使用 App Token 测试接口
 *   node test-dev-token.js --test POST /app/test/info --token-type app
 *   node test-dev-token.js --test GET /system/user/list --token-type system
 *   node test-dev-token.js --batch-test <文件名>                    # 批量测试，文件必须在 batch-tests 目录
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

// ============================================================
// 路径配置
// ============================================================
const DEV_TOKEN_TEST_DIR = path.resolve(__dirname, '..');
const APP_RESTARTER_DIR = path.resolve(__dirname, '../../app-restarter');
const CONFIG_FILE = path.join(APP_RESTARTER_DIR, 'config.json');
const TOKEN_CACHE_FILE = path.join(APP_RESTARTER_DIR, 'token-cache.json');
const REPORTS_DIR = path.join(DEV_TOKEN_TEST_DIR, 'reports');
const BATCH_TESTS_DIR = path.join(DEV_TOKEN_TEST_DIR, 'batch-tests');
const MAX_REPORTS = 10; // 最大保留报告数量

// ============================================================
// 目录初始化
// ============================================================
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * 清理旧报告文件，保留最近 MAX_REPORTS 个
 * 并在每个报告开头添加文件索引信息
 */
function cleanupOldReports() {
    ensureDir(REPORTS_DIR);
    
    const files = fs.readdirSync(REPORTS_DIR)
        .filter(f => f.endsWith('.md'))
        .map(f => {
            const filePath = path.join(REPORTS_DIR, f);
            const stats = fs.statSync(filePath);
            return {
                name: f,
                path: filePath,
                mtime: stats.mtime,
                mtimeMs: stats.mtimeMs
            };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs); // 按修改时间倒序

    // 如果超过最大数量，删除旧的
    if (files.length > MAX_REPORTS) {
        const filesToDelete = files.slice(MAX_REPORTS);
        for (const file of filesToDelete) {
            try {
                fs.unlinkSync(file.path);
                log(`已清理旧报告: ${file.name}`, 'info');
            } catch (e) {
                // 忽略删除错误
            }
        }
    }

    // 为每个报告文件添加索引信息
    const remainingFiles = files.slice(0, MAX_REPORTS);
    const now = new Date();
    
    remainingFiles.forEach((file, index) => {
        try {
            const content = fs.readFileSync(file.path, 'utf-8');
            const age = Math.floor((now - file.mtime) / 1000 / 60); // 分钟
            let ageText;
            if (age < 1) ageText = '刚刚';
            else if (age < 60) ageText = `${age}分钟前`;
            else if (age < 1440) ageText = `${Math.floor(age / 60)}小时前`;
            else ageText = `${Math.floor(age / 1440)}天前`;

            const indexHeader = `<!-- 报告索引: ${index + 1}/${remainingFiles.length} | 生成时间: ${file.mtime.toLocaleString('zh-CN')} | ${ageText} -->\n`;
            
            // 如果文件还没有索引头，添加它
            if (!content.startsWith('<!-- 报告索引')) {
                fs.writeFileSync(file.path, indexHeader + content, 'utf-8');
            }
        } catch (e) {
            // 忽略错误
        }
    });

    return remainingFiles;
}

// ============================================================
// 配置加载
// ============================================================

function loadAppRestarterConfig() {
    try {
        const configContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const config = JSON.parse(configContent);
        return config;
    } catch (error) {
        console.error(`加载配置文件失败: ${CONFIG_FILE}`);
        console.error(`错误: ${error.message}`);
        return null;
    }
}

function getConfiguredModules(config) {
    if (!config || !config.modules) {
        return [];
    }
    return Object.entries(config.modules).map(([name, moduleConfig]) => ({
        name,
        ...moduleConfig
    }));
}

// ============================================================
// Java接口注释提取
// ============================================================

function extractJavaDocComment(content, methodLine) {
    const lines = content.split('\n');
    let commentStart = -1;
    let braceCount = 0;
    let inComment = false;

    for (let i = methodLine - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('/*')) {
            inComment = true;
            commentStart = i;
            break;
        }
        if (line.startsWith('*') || line.startsWith('//')) {
            continue;
        }
        if (line.length > 0 && !line.startsWith('*') && !line.startsWith('//')) {
            break;
        }
    }

    if (commentStart === -1) return null;

    let comment = '';
    for (let i = commentStart; i < methodLine && i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('/*') || line.startsWith('*')) {
            comment += line.replace(/^\*\s*/, '').replace(/^\/\*\*/, '') + '\n';
        }
    }
    return comment.trim();
}

function extractApiDescriptions(controllerPaths) {
    const descriptions = {};
    for (const controllerPath of controllerPaths) {
        try {
            if (!fs.existsSync(controllerPath)) continue;
            const content = fs.readFileSync(controllerPath, 'utf-8');
            const lines = content.split('\n');
            const methodPatterns = [
                /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*"([^"]+)/,
                /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*"([^"]+)/g
            ];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const match = line.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*"([^"]+)/);
                if (match) {
                    const httpMethod = match[1].toUpperCase();
                    const path = match[2];
                    const comment = extractJavaDocComment(content, i);
                    if (comment) {
                        descriptions[`${httpMethod} ${path}`] = comment;
                    }
                }
            }
        } catch (e) {
        }
    }
    return descriptions;
}

// ============================================================
// 日志读取功能
// ============================================================

function readApplicationLogs(moduleConfig, errorPattern = null) {
    const { name, modulePath, logFiles } = moduleConfig;
    const baseModulePath = modulePath || 'ruoyi-admin';

    const defaultLogFiles = [
        path.join(baseModulePath, 'target', 'startup.log'),
        path.join(baseModulePath, 'target', 'startup-error.log'),
        path.join(baseModulePath, 'logs', 'sys-error.log'),
        path.join(baseModulePath, 'logs', 'sys-console.log')
    ];

    const filesToRead = Array.isArray(logFiles) && logFiles.length > 0
        ? logFiles.map(f => path.join(baseModulePath, f))
        : defaultLogFiles;

    const allLogs = [];

    for (const logFile of filesToRead) {
        try {
            if (fs.existsSync(logFile)) {
                const content = fs.readFileSync(logFile, 'utf-8');
                const lines = content.split('\n');
                const lineCount = lines.length;

                if (lineCount > 5000) {
                    fs.writeFileSync(logFile, '', 'utf-8');
                }

                if (errorPattern) {
                    const matchedLines = [];
                    let inErrorBlock = false;
                    let errorLines = [];

                    for (const line of lines) {
                        if (line.match(errorPattern) || line.includes('Exception') || line.includes('ERROR')) {
                            inErrorBlock = true;
                            errorLines = [];
                        }
                        if (inErrorBlock) {
                            errorLines.push(line);
                            if (line.trim() === '' || errorLines.length > 50) {
                                if (errorLines.length > 0) {
                                    matchedLines.push(...errorLines);
                                }
                                inErrorBlock = false;
                            }
                        }
                    }
                    if (errorLines.length > 0) {
                        matchedLines.push(...errorLines);
                    }
                    if (matchedLines.length > 0) {
                        allLogs.push(...matchedLines);
                    }
                } else {
                    const recentLines = lines.slice(-100);
                    allLogs.push(...recentLines);
                }
            }
        } catch (e) {
        }
    }

    return allLogs.slice(-100).join('\n');
}

function extractErrorFromLogs(logs, apiPath) {
    if (!logs) return null;

    const lines = logs.split('\n');
    const errors = [];
    let inError = false;
    let currentError = [];

    for (const line of lines) {
        if (line.includes('Exception') || line.includes('ERROR') || line.includes('Failed')) {
            inError = true;
            currentError = [];
        }
        if (inError) {
            currentError.push(line);
            if (line.trim() === '' && currentError.length > 3) {
                errors.push(currentError.join('\n'));
                inError = false;
            }
        }
    }

    if (currentError.length > 0) {
        errors.push(currentError.join('\n'));
    }

    return errors.length > 0 ? errors.slice(-3).join('\n\n') : null;
}

// ============================================================
// Token缓存管理
// ============================================================

function loadTokenCache() {
    try {
        if (fs.existsSync(TOKEN_CACHE_FILE)) {
            const data = fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
    }
    return {};
}

function saveTokenCache(cache) {
    try {
        fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.warn(`警告: 无法保存Token缓存: ${e.message}`);
    }
}

// ============================================================
// VO字段注释提取
// ============================================================

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const VO_SEARCH_PATHS = [
    path.join(PROJECT_ROOT, 'ruoyi-modules', 'app', 'src', 'main', 'java', 'org', 'dromara', 'app', 'mobile', 'domain', 'vo'),
    path.join(PROJECT_ROOT, 'ruoyi-modules', 'app', 'src', 'main', 'java', 'org', 'dromara', 'app', 'system', 'domain', 'vo'),
];

const API_VO_MAPPING = {
    '/app/match/info': ['MatchInfoVo'],
    '/app/match/session/list': ['MatchSessionVo'],
    '/app/match/session': ['MatchSessionVo'],
    '/app/order/create': ['MatchOrderVo'],
    '/app/order/list': ['MatchOrderVo'],
    '/authijm/getUserInfo': ['JytUserVo'],
};

function findVoClassForApi(apiPath) {
    const voNames = API_VO_MAPPING[apiPath];
    if (!voNames) return [];

    const voFiles = [];
    for (const voName of voNames) {
        for (const searchPath of VO_SEARCH_PATHS) {
            const voFile = path.join(searchPath, `${voName}.java`);
            if (fs.existsSync(voFile)) {
                voFiles.push(voFile);
                break;
            }
        }
    }
    return voFiles;
}

function extractVoFieldComments(voFilePath) {
    if (!fs.existsSync(voFilePath)) return {};

    const content = fs.readFileSync(voFilePath, 'utf-8');
    const lines = content.split('\n');
    const fieldComments = {};

    let currentComment = '';
    let inComment = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('/**')) {
            inComment = true;
            currentComment = '';
            continue;
        }

        if (inComment && line.startsWith('*/')) {
            inComment = false;
            continue;
        }

        if (inComment && line.startsWith('*')) {
            const commentLine = line.substring(1).trim();
            if (commentLine && !commentLine.startsWith('@')) {
                currentComment += (currentComment ? ' ' : '') + commentLine;
            }
            continue;
        }

        if (!inComment && currentComment) {
            const fieldMatch = line.match(/private\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/);
            if (fieldMatch) {
                const fieldName = fieldMatch[2];
                const fieldType = fieldMatch[1];
                if (fieldName && currentComment) {
                    fieldComments[fieldName] = {
                        type: fieldType,
                        comment: currentComment.trim()
                    };
                }
            }
            currentComment = '';
        }
    }

    return fieldComments;
}

function extractAllVoComments(apiPath) {
    const voFiles = findVoClassForApi(apiPath);
    const allComments = {};

    for (const voFile of voFiles) {
        const comments = extractVoFieldComments(voFile);
        Object.assign(allComments, comments);
    }

    return allComments;
}

// ============================================================
// JSON5格式转换
// ============================================================

function jsonToJson5WithComments(jsonObj, fieldComments = {}, indent = 0) {
    const indentStr = '  '.repeat(indent);
    const nextIndentStr = '  '.repeat(indent + 1);

    if (jsonObj === null) {
        return 'null';
    }

    if (typeof jsonObj !== 'object') {
        if (typeof jsonObj === 'string') {
            return `"${jsonObj}"`;
        }
        return String(jsonObj);
    }

    if (Array.isArray(jsonObj)) {
        if (jsonObj.length === 0) {
            return '[]';
        }

        const items = jsonObj.map((item, index) => {
            const itemJson5 = jsonToJson5WithComments(item, fieldComments, indent + 1);
            return `${nextIndentStr}${itemJson5}`;
        });

        return `[\n${items.join(',\n')}\n${indentStr}]`;
    }

    const entries = Object.entries(jsonObj);
    if (entries.length === 0) {
        return '{}';
    }

    const lines = entries.map(([key, value]) => {
        const comment = fieldComments[key]?.comment || '';
        const commentStr = comment ? `  // ${comment}` : '';

        let valueStr;
        if (value === null) {
            valueStr = 'null';
        } else if (typeof value === 'object') {
            valueStr = jsonToJson5WithComments(value, fieldComments, indent + 1);
        } else if (typeof value === 'string') {
            valueStr = `"${value}"`;
        } else {
            valueStr = String(value);
        }

        return `${nextIndentStr}${key}: ${valueStr},${commentStr}`;
    });

    return `{\n${lines.join('\n')}\n${indentStr}}`;
}

function formatJson5WithComments(jsonObj, apiPath = null) {
    const fieldComments = apiPath ? extractAllVoComments(apiPath) : {};
    return jsonToJson5WithComments(jsonObj, fieldComments, 0);
}

// ============================================================
// 测试报告生成
// ============================================================

function generateTestReport(moduleConfig, results, testType, customApi = null) {
    const { name, port, contextPath = '/dev-api' } = moduleConfig;
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    const hasErrors = failed > 0;

    let resultsTable = '';
    if (results.length > 0) {
        resultsTable = '| 状态 | 测试用例 | 接口描述 | 详情 |\n|------|----------|----------|------|\n';
        for (const r of results) {
            const status = r.passed ? '✅ PASS' : '❌ FAIL';
            const details = r.error || (r.status ? `HTTP ${r.status}` : '-');
            const description = r.description || r.apiDescription || '-';
            resultsTable += `| ${status} | ${r.name} | ${description} | ${details} |\n`;
        }
    }

    let testDetails = '';
    for (const r of results) {
        if (!r.passed && hasErrors) {
            testDetails += `\n### ${r.name}\n\n`;
            testDetails += `- **状态**: ❌ 失败\n`;
            testDetails += `- **错误**: ${r.error || '未知错误'}\n`;
            testDetails += `- **HTTP状态码**: ${r.status || '-'}\n`;

            if (r.data) {
                testDetails += `- **响应数据**: \n\`\`\`json\n${JSON.stringify(r.data, null, 2).substring(0, 500)}\n\`\`\`\n`;
            }

            const logs = readApplicationLogs(moduleConfig);
            const errorDetail = extractErrorFromLogs(logs, customApi);
            if (errorDetail) {
                testDetails += `- **服务器日志**:\n\`\`\`\n${errorDetail.substring(0, 1500)}\n\`\`\`\n`;
            }
            testDetails += '\n---\n';
        }
    }

    let requestDetails = '';
    if (customApi) {
        const [method, apiPath] = customApi.split(' ');
        requestDetails = `
| 项目 | 内容 |
|------|------|
| 请求方法 | ${method} |
| 请求路径 | ${apiPath} |
| 完整URL | http://localhost:${port}${contextPath}${apiPath} |
`;
    }

    let apiDetails = '';
    for (const r of results) {
        const desc = r.description || r.apiDescription || r.name || '';
        const statusText = r.passed ? '✅ PASS' : '❌ FAIL';
        const httpStatus = r.status || '-';
        apiDetails += `### ${statusText} | ${r.name}\n\n`;
        if (desc && desc !== r.name) {
            apiDetails += `**接口描述**: ${desc}\n\n`;
        }
        apiDetails += `**HTTP状态码**: ${httpStatus}\n\n`;

        if (r.requestBody) {
            apiDetails += `**请求参数**:\n\n\`\`\`json5\n`;
            try {
                const bodyJson = typeof r.requestBody === 'string' ? JSON.parse(r.requestBody) : r.requestBody;
                apiDetails += jsonToJson5WithComments(bodyJson, {}, 0);
            } catch (e) {
                apiDetails += r.requestBody;
            }
            apiDetails += '\n```\n\n';
        }

        if (r.data) {
            apiDetails += `**响应结果**:\n\n\`\`\`json5\n`;
            const apiPath = r.apiPath || (customApi ? customApi.split(' ')[1] : null);
            apiDetails += formatJson5WithComments(r.data, apiPath);
            apiDetails += '\n```\n\n';
        } else if (!r.passed && r.error) {
            apiDetails += `**错误信息**: ${r.error}\n\n`;
        }

        apiDetails += '---\n\n';
    }

    let errorDetails = '';
    if (hasErrors) {
        errorDetails = '```\n';
        for (const r of results) {
            if (!r.passed) {
                errorDetails += `[${r.name}] ${r.error || '未知错误'}\n`;
                const logs = readApplicationLogs(moduleConfig);
                const errorDetail = extractErrorFromLogs(logs, customApi);
                if (errorDetail) {
                    errorDetails += `\n--- 日志内容 ---\n${errorDetail.substring(0, 1000)}\n`;
                }
                errorDetails += '\n';
            }
        }
        errorDetails += '```\n';
    }

    const template = fs.readFileSync(path.join(DEV_TOKEN_TEST_DIR, 'templates', 'test-report.md'), 'utf-8');

    const report = template
        .replace('{timestamp}', timestamp)
        .replace('{module}', name)
        .replace('{port}', String(port))
        .replace('{contextPath}', contextPath)
        .replace('{testType}', testType)
        .replace('{total}', String(total))
        .replace('{passed}', String(passed))
        .replace('{failed}', String(failed))
        .replace('{results_table}', resultsTable || '无测试结果')
        .replace('{test_details}', testDetails || '所有测试通过 ✅')
        .replace('{request_details}', requestDetails || '无自定义请求')
        .replace('{api_details}', apiDetails || '无接口详情')
        .replace('{error_details}', errorDetails || '无错误信息');

    return report;
}

function saveTestReport(moduleConfig, results, testType, customApi = null, isSummary = false) {
    const { name } = moduleConfig;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportName = isSummary
        ? `summary-report-${timestamp}.md`
        : (customApi
            ? `${name}-${customApi.replace(/[\/\s]/g, '-')}-${timestamp}.md`
            : `${name}-${testType}-${timestamp}.md`);
    const reportPath = path.join(REPORTS_DIR, reportName);

    const report = generateTestReport(moduleConfig, results, testType, customApi);

    try {
        fs.writeFileSync(reportPath, report, 'utf-8');
        // 清理旧报告并添加索引
        cleanupOldReports();
        return reportPath;
    } catch (e) {
        console.warn(`警告: 无法保存测试报告: ${e.message}`);
        return null;
    }
}

// ============================================================
// HTTP请求工具
// ============================================================

function request(options, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.path, options.baseUrl);
        const protocol = url.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

        const req = protocol.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ status: res.statusCode, data: jsonData, headers: res.headers });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, headers: res.headers });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });

        req.setTimeout(options.timeout || 10000);

        if (bodyStr) {
            req.write(bodyStr);
        }
        req.end();
    });
}

// ============================================================
// 日志工具
// ============================================================

function log(message, type = 'info') {
    const colors = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        green: '\x1b[32m',
        red: '\x1b[31m',
        yellow: '\x1b[33m',
        blue: '\x1b[36m',
        cyan: '\x1b[96m',
        gray: '\x1b[90m'
    };

    const prefixes = {
        info: '[INFO]',
        success: '[PASS]',
        fail: '[FAIL]',
        warn: '[WARN]',
        test: '[TEST]',
        result: '[RESULT]',
        module: '[MODULE]',
        request: '[REQ]',
        response: '[RESP]',
        report: '[REPORT]',
        error: '[ERROR]'
    };

    const color = {
        info: colors.blue,
        success: colors.green,
        fail: colors.red,
        warn: colors.yellow,
        test: colors.bright + colors.blue,
        result: colors.bright + colors.green,
        module: colors.bright + colors.yellow,
        request: colors.cyan,
        response: colors.gray,
        report: colors.bright + colors.cyan,
        error: colors.red
    };

    console.log(`${color[type]}${prefixes[type] || '[INFO]'}${colors.reset} ${message}`);
}

// ============================================================
// 测试用例工厂
// ============================================================

function createModuleTests(moduleConfig) {
    const { name, port, contextPath = '/dev-api' } = moduleConfig;
    const baseUrl = `http://localhost:${port}`;

    async function testHealthCheck() {
        const testName = `TC-000: ${name} - 环境健康检查`;
        log(`开始测试: ${testName}`, 'test');

        try {
            const response = await request({
                method: 'GET',
                path: `${contextPath}/auth/devToken`,
                baseUrl,
                timeout: 5000
            });

            if ([200, 401, 500].includes(response.status)) {
                log(`[${name}] 服务正常运行 (${baseUrl}${contextPath})`, 'success');
                return { name: testName, module: name, passed: true };
            }

            return {
                name: testName,
                module: name,
                passed: false,
                error: `HTTP ${response.status}`
            };
        } catch (error) {
            return {
                name: testName,
                module: name,
                passed: false,
                error: error.message
            };
        }
    }

    async function customRequest(method, apiPath, headers = {}, body = null) {
        const testName = `CUSTOM: ${method} ${apiPath}`;
        const fullPath = `${contextPath}${apiPath}`;
        log(`开始测试: ${testName}`, 'test');

        try {
            log(`请求: ${method} ${baseUrl}${fullPath}`, 'request');
            if (headers['Authorization']) {
                const authStr = headers['Authorization'];
                const displayAuth = authStr.length > 50 ? authStr.substring(0, 50) + '...' : authStr;
                log(`认证: Bearer ${displayAuth}`, 'request');
            }
            if (body) {
                let displayBody = body;
                if (typeof body === 'string') {
                    try {
                        displayBody = JSON.stringify(JSON.parse(body), null, 2);
                    } catch (e) {}
                }
                log(`[REQ-BODY] 请求体:`, 'request');
                console.log('```json');
                console.log(displayBody);
                console.log('```');
            }

            const response = await request({
                method: method.toUpperCase(),
                path: fullPath,
                baseUrl,
                headers,
                timeout: 15000
            }, body);

            log(`响应: HTTP ${response.status}`, 'response');
            let responseBody = response.data;
            if (typeof responseBody === 'string') {
                try {
                    responseBody = JSON.parse(responseBody);
                } catch (e) {}
            }
            const displayResponse = JSON.stringify(responseBody, null, 2);
            log(`[RESP-BODY] 响应体:`, 'response');
            console.log('```json');
            console.log(displayResponse);
            console.log('```');

            const httpSuccess = response.status >= 200 && response.status < 300;
            const responseStr = typeof responseBody === 'string' ? responseBody : String(responseBody);
            const isPlainTextSuccess = responseStr.trim() === '200' || responseStr.trim() === 'success';

            let errorMsg = null;
            let passed = false;
            if (!httpSuccess) {
                errorMsg = `HTTP ${response.status}`;
            } else if (isPlainTextSuccess) {
                passed = true;
            } else if (responseBody?.code === 200 || responseBody?.code === 0) {
                passed = true;
            } else {
                errorMsg = responseBody?.msg || `业务失败: code=${responseBody?.code}`;
            }

            return {
                name: testName,
                module: name,
                passed,
                status: response.status,
                data: responseBody,
                requestBody: body,
                error: errorMsg,
                apiPath: apiPath
            };
        } catch (error) {
            return { name: testName, module: name, passed: false, error: error.message, apiPath: apiPath };
        }
    }

    return {
        name,
        baseUrl,
        contextPath,
        port,
        testHealthCheck,
        customRequest
    };
}

// ============================================================
// 批量测试配置文件处理
// ============================================================

/**
 * 获取批量测试配置文件路径
 * 强制限制在 batch-tests 目录中
 * @param {string} filename - 配置文件名（不含路径）
 * @returns {string|null} - 完整的文件路径，如果无效则返回 null
 */
function getBatchTestFilePath(filename) {
    // 确保 batch-tests 目录存在
    ensureDir(BATCH_TESTS_DIR);

    // 清理文件名，防止路径遍历攻击
    const cleanFilename = path.basename(filename);
    
    // 检查文件名是否有效
    if (!cleanFilename || cleanFilename === '.' || cleanFilename === '..') {
        log('错误: 无效的配置文件名', 'fail');
        return null;
    }

    // 构建完整路径
    const fullPath = path.join(BATCH_TESTS_DIR, cleanFilename);
    
    // 安全检查：确保文件在 batch-tests 目录内
    const resolvedPath = path.resolve(fullPath);
    const resolvedBatchDir = path.resolve(BATCH_TESTS_DIR);
    
    if (!resolvedPath.startsWith(resolvedBatchDir)) {
        log('错误: 配置文件必须在 batch-tests 目录中', 'fail');
        return null;
    }

    return fullPath;
}

/**
 * 列出可用的批量测试配置文件
 */
function listBatchTestFiles() {
    ensureDir(BATCH_TESTS_DIR);
    
    try {
        const files = fs.readdirSync(BATCH_TESTS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const stats = fs.statSync(path.join(BATCH_TESTS_DIR, f));
                return {
                    name: f,
                    mtime: stats.mtime.toLocaleString('zh-CN')
                };
            });
        
        if (files.length === 0) {
            log('batch-tests 目录中没有找到 JSON 配置文件', 'warn');
            return [];
        }
        
        log('\n可用的批量测试配置文件:', 'info');
        console.log('='.repeat(60));
        files.forEach(f => {
            console.log(`  ${f.name}`);
            console.log(`    修改时间: ${f.mtime}`);
        });
        console.log('='.repeat(60));
        return files;
    } catch (e) {
        log(`读取 batch-tests 目录失败: ${e.message}`, 'fail');
        return [];
    }
}

// ============================================================
// 主函数
// ============================================================

async function main() {
    const args = process.argv.slice(2);

    const appRestarterConfig = loadAppRestarterConfig();
    const modules = getConfiguredModules(appRestarterConfig);

    if (modules.length === 0) {
        log('未找到任何已配置的模块', 'fail');
        process.exit(1);
    }

    // 清理旧报告
    cleanupOldReports();

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Dev Token Test Suite v3.5.0 - 开发环境Token与接口测试工具

用法:
  node test-dev-token.js [选项]

选项:
  --list                    列出所有已配置的模块
  --list-batch              列出 batch-tests 目录中的测试配置文件
  --module <名称>           测试指定模块的Token获取流程
  --test <方法> <路径>      测试指定接口 (如: GET /admin/test/hello)
  --batch-test <文件名>     批量测试，文件必须在 batch-tests 目录中
  --header <key:value>      添加请求头 (可多次使用)
  --body <json>             请求体 (JSON格式)
  --token-type <type>       使用哪种Token: system 或 app (默认: app)
  --no-report               禁用测试报告生成
  --help, -h                显示帮助信息

示例:
  # 列出所有模块
  node test-dev-token.js --list

  # 列出批量测试配置文件
  node test-dev-token.js --list-batch

  # 测试Token获取流程
  node test-dev-token.js --module app

  # 使用App Token测试接口
  node test-dev-token.js --test GET /app/match/info

  # 批量测试（使用 batch-tests/order-tests.json）
  node test-dev-token.js --batch-test order-tests.json

  # POST请求带Body
  node test-dev-token.js --test POST /app/order/create --body '{"tid":"541735"}'

  # 禁用报告生成
  node test-dev-token.js --test GET /app/match/info --no-report
`);
        process.exit(0);
    }

    if (args.includes('--list')) {
        console.log('\n已配置的模块:');
        console.log('='.repeat(60));
        modules.forEach(m => {
            console.log(`  ${m.name}`);
            console.log(`    URL: http://localhost:${m.port}${m.contextPath || '/dev-api'}`);
            console.log('');
        });
        process.exit(0);
    }

    if (args.includes('--list-batch')) {
        listBatchTestFiles();
        process.exit(0);
    }

    const batchTestIndex = args.indexOf('--batch-test');
    const isBatchTest = batchTestIndex !== -1;
    
    // 处理批量测试文件路径
    let batchTestFile = null;
    if (isBatchTest) {
        const filename = args[batchTestIndex + 1];
        if (!filename || filename.startsWith('--')) {
            log('错误: --batch-test 需要指定配置文件名', 'fail');
            log('使用 --list-batch 查看可用配置文件', 'info');
            process.exit(1);
        }
        batchTestFile = getBatchTestFilePath(filename);
        if (!batchTestFile) {
            process.exit(1);
        }
    }

    let targetModules = modules;
    const moduleIndex = args.indexOf('--module');
    if (moduleIndex !== -1 && args[moduleIndex + 1] && !args[moduleIndex + 1].startsWith('--')) {
        const moduleName = args[moduleIndex + 1];
        targetModules = modules.filter(m => m.name === moduleName);
        if (targetModules.length === 0) {
            log(`未找到指定的模块: ${moduleName}`, 'fail');
            log(`可用模块: ${modules.map(m => m.name).join(', ')}`, 'info');
            process.exit(1);
        }
    }

    const testIndex = args.indexOf('--test');
    const isCustomTest = testIndex !== -1;
    const noReport = args.includes('--no-report');

    function parseBodyArg(arg) {
        if (!arg) return null;
        if (typeof arg !== 'string') return arg;
        let result = arg.trim();
        if (result.length === 0) return null;

        // 处理 PowerShell 传递的 JSON（字段名可能没有引号）
        if ((result.startsWith('{') && result.endsWith('}')) ||
            (result.startsWith('[') && result.endsWith(']'))) {
            try {
                // 先尝试直接解析
                const parsed = JSON.parse(result);
                return JSON.stringify(parsed);
            } catch (e) {
                // 如果解析失败，尝试修复字段名没有引号的 JSON
                try {
                    // 给没有引号的字段名添加双引号
                    const fixedJson = result.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
                    const parsed = JSON.parse(fixedJson);
                    return JSON.stringify(parsed);
                } catch (e2) {
                    // 修复失败，返回原字符串
                }
            }
        }
        return result;
    }

    function convertHeadersToQueryParams(apiPath, headers) {
        const excludeHeaders = ['authorization', 'clientid', 'content-type', 'user-agent'];
        const queryParams = [];
        for (const [key, value] of Object.entries(headers)) {
            if (!excludeHeaders.includes(key.toLowerCase()) && value) {
                queryParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
            }
        }
        if (queryParams.length > 0) {
            return apiPath + (apiPath.includes('?') ? '&' : '?') + queryParams.join('&');
        }
        return apiPath;
    }

    let customMethod = 'GET';
    let customPath = '/';
    let customHeaders = {};
    let customBody = null;
    let tokenType = 'app';

    let headerIndex = args.indexOf('--header');
    while (headerIndex !== -1 && args[headerIndex + 1] && !args[headerIndex + 1].startsWith('--')) {
        const [key, value] = args[headerIndex + 1].split(':');
        if (key && value) customHeaders[key.trim()] = value.trim();
        headerIndex = args.indexOf('--header', headerIndex + 1);
    }

    if (isCustomTest) {
        if (args[testIndex + 1]) customMethod = args[testIndex + 1];
        if (args[testIndex + 2]) customPath = args[testIndex + 2];

        const bodyIndex = args.indexOf('--body');
        if (bodyIndex !== -1 && args[bodyIndex + 1] && !args[bodyIndex + 1].startsWith('--')) {
            customBody = parseBodyArg(args[bodyIndex + 1]);
        }

        const tokenTypeIndex = args.indexOf('--token-type');
        if (tokenTypeIndex !== -1 && args[tokenTypeIndex + 1]) {
            tokenType = args[tokenTypeIndex + 1].toLowerCase();
        }
    }

    console.log('\n' + '='.repeat(60));
    log(`Dev Token Test Suite v3.5.0`, 'info');
    log(`测试报告目录: ${REPORTS_DIR}`, 'info');
    if (isBatchTest) {
        log(`批量测试配置: ${batchTestFile}`, 'info');
    }
    console.log('='.repeat(60));

    const allResults = [];
    const tokenCache = loadTokenCache();

    for (const moduleConfig of targetModules) {
        const testRunner = createModuleTests(moduleConfig);
        const moduleResults = [];

        console.log('\n' + '-'.repeat(60));
        log(`模块: ${moduleConfig.name} (http://localhost:${moduleConfig.port})`, 'module');
        console.log('-'.repeat(60));

        const healthResult = await testRunner.testHealthCheck();
        moduleResults.push(healthResult);
        allResults.push(healthResult);

        if (!healthResult.passed) {
            log('环境检查失败，跳过此模块', 'fail');
            continue;
        }

        if (isCustomTest || isBatchTest) {
            let token = null;
            let clientId = null;
            let tokenLabel = '';

            const cacheKey = `${moduleConfig.name}_${tokenType}`;
            if (tokenCache[cacheKey]) {
                token = tokenCache[cacheKey].token;
                clientId = tokenCache[cacheKey].clientId;
                tokenLabel = '(从缓存加载)';
            }

            if (!token) {
                log(`\n获取 ${tokenType} Token...`, 'info');
                // 简化Token获取流程
                try {
                    const tokenResponse = await request({
                        method: 'GET',
                        path: `${moduleConfig.contextPath || '/dev-api'}/authijm/authMe`,
                        baseUrl: testRunner.baseUrl,
                        timeout: 10000
                    });

                    if (tokenResponse.status === 200 && tokenResponse.data.code === 200 && tokenResponse.data.data?.token) {
                        token = tokenResponse.data.data.token;
                        clientId = tokenResponse.data.data.clientid;
                        tokenLabel = '(新获取)';
                        tokenCache[cacheKey] = { token, clientId, timestamp: Date.now() };
                        saveTokenCache(tokenCache);
                        log(`Token获取成功: ${token.substring(0, 30)}...`, 'success');
                    } else {
                        throw new Error(tokenResponse.data?.msg || 'Token获取失败');
                    }
                } catch (error) {
                    allResults.push({ name: `Token获取失败`, module: moduleConfig.name, passed: false, error: error.message });
                    continue;
                }
            }

            log(`\n使用 ${tokenType} Token ${tokenLabel} 测试`, 'info');

            if (!customHeaders['Authorization']) {
                customHeaders['Authorization'] = `Bearer ${token}`;
            }
            if (!customHeaders['clientid']) {
                customHeaders['clientid'] = clientId;
            }

            if (isBatchTest && batchTestFile) {
                let batchTests = [];
                try {
                    const batchContent = fs.readFileSync(batchTestFile, 'utf-8');
                    batchTests = JSON.parse(batchContent);
                    // 测试完成后清空配置文件
                    fs.writeFileSync(batchTestFile, '[]', 'utf-8');
                } catch (e) {
                    log(`读取批量测试配置文件失败: ${e.message}`, 'fail');
                    process.exit(1);
                }

                const controllerPaths = [
                    path.join(PROJECT_ROOT, 'ruoyi-modules', 'app', 'src', 'main', 'java', 'org', 'dromara', 'app', 'mobile', 'controller', 'SmkPayController.java'),
                    path.join(PROJECT_ROOT, 'ruoyi-modules', 'app', 'src', 'main', 'java', 'org', 'dromara', 'app', 'mobile', 'controller', 'SmkPayCallbackController.java')
                ];
                const apiDescriptions = extractApiDescriptions(controllerPaths);

                log(`\n开始批量测试，共 ${batchTests.length} 个接口`, 'info');

                for (const testCase of batchTests) {
                    const { method = 'GET', path: testPath, description, body: testBody, tokenType: testTokenType } = testCase;
                    const fullPath = `${moduleConfig.contextPath || '/dev-api'}${testPath}`;

                    log(`\n测试: ${method} ${testPath}`, 'test');
                    if (description) {
                        log(`描述: ${description}`, 'info');
                    }

                    const descKey = `${method.toUpperCase()} ${testPath}`;
                    const apiDesc = apiDescriptions[descKey];
                    if (apiDesc) {
                        log(`接口说明: ${apiDesc.split('\n')[0]}`, 'info');
                    }

                    const testHeaders = { ...customHeaders };
                    if (testTokenType) {
                        const testCacheKey = `${moduleConfig.name}_${testTokenType}`;
                        if (tokenCache[testCacheKey]) {
                            testHeaders['Authorization'] = `Bearer ${tokenCache[testCacheKey].token}`;
                            testHeaders['clientid'] = tokenCache[testCacheKey].clientId;
                        }
                    }

                    let requestPath = testPath;
                    if (method.toUpperCase() === 'GET') {
                        requestPath = convertHeadersToQueryParams(testPath, testHeaders);
                    }
                    const result = await testRunner.customRequest(method.toUpperCase(), requestPath, testHeaders, testBody || null);

                    const resultWithDesc = {
                        ...result,
                        description: description || apiDesc || '',
                        apiDescription: apiDesc || ''
                    };
                    moduleResults.push(resultWithDesc);
                    allResults.push(resultWithDesc);

                    if (result.passed) {
                        log(`测试通过! HTTP ${result.status}`, 'success');
                    } else {
                        log(`测试失败: ${result.error || `HTTP ${result.status}`}`, 'fail');
                    }
                }
            } else if (isCustomTest) {
                let requestPath = customPath;
                if (customMethod.toUpperCase() === 'GET' && Object.keys(customHeaders).length > 0) {
                    requestPath = convertHeadersToQueryParams(customPath, customHeaders);
                }
                const result = await testRunner.customRequest(customMethod, requestPath, customHeaders, customBody);
                moduleResults.push(result);
                allResults.push(result);

                if (result.passed) {
                    log(`测试通过! HTTP ${result.status}`, 'success');
                } else {
                    log(`测试失败: ${result.error || `HTTP ${result.status}`}`, 'fail');
                    log(`正在读取服务器日志获取详细信息...`, 'warn');

                    const logs = readApplicationLogs(moduleConfig);
                    const errorDetail = extractErrorFromLogs(logs, customPath);
                    if (errorDetail) {
                        log(`服务器错误信息:`, 'error');
                        console.log('```');
                        console.log(errorDetail.substring(0, 1000));
                        console.log('```');
                    }
                }
            }

            saveTokenCache(tokenCache);
        }
    }

    console.log('\n\n' + '='.repeat(60));
    log('测试结果摘要', 'result');
    console.log('='.repeat(60));

    const passed = allResults.filter(r => r.passed).length;
    const failed = allResults.filter(r => !r.passed).length;
    const total = allResults.length;

    allResults.forEach(r => {
        const status = r.passed ? 'PASS' : 'FAIL';
        const statusColor = r.passed ? 'success' : 'fail';
        log(`${status} - ${r.name}`, statusColor);
        if (!r.passed && r.error) {
            log(`     错误: ${r.error}`, 'warn');
        }
    });

    console.log('\n' + '-'.repeat(60));
    log(`总计: ${total} | 通过: ${passed} | 失败: ${failed}`, passed === total ? 'success' : 'warn');
    console.log('='.repeat(60));

    if (!noReport && targetModules.length === 1) {
        const testType = isCustomTest ? `${customMethod} ${customPath}` : (isBatchTest ? '批量测试' : 'Token获取流程');
        const customApi = isCustomTest ? `${customMethod} ${customPath}` : null;
        const reportPath = saveTestReport(targetModules[0], allResults, testType, customApi, true);
        if (reportPath) {
            log(`\n完整测试报告: ${reportPath}`, 'report');
            
            // 显示报告索引信息
            const reports = cleanupOldReports();
            if (reports.length > 1) {
                log(`\n历史报告 (${reports.length}个):`, 'info');
                reports.forEach((r, i) => {
                    const age = Math.floor((new Date() - r.mtime) / 1000 / 60);
                    let ageText;
                    if (age < 1) ageText = '刚刚';
                    else if (age < 60) ageText = `${age}分钟前`;
                    else if (age < 1440) ageText = `${Math.floor(age / 60)}小时前`;
                    else ageText = `${Math.floor(age / 1440)}天前`;
                    console.log(`  ${i + 1}. ${r.name} (${ageText})`);
                });
            }
        }
    }

    process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {
    log(`执行错误: ${error.message}`, 'fail');
    process.exit(1);
});
