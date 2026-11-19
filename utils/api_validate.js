import path from 'path';
import {readFile} from 'fs/promises';
import fileHeaderManager from "./fileHeaderManager.js";
import {isPublicConfigRequest, validateAdminAuth} from "./security/auth.js";
import {PathSecurityError, resolveInside} from "./security/pathGuard.js";
import {createLogger as __createLogger} from './logger.js';
const _log = __createLogger('utils/api_validate');

// 检查是否运行在Vercel环境
const IS_VERCEL = process.env.VERCEL;
// 剪切板安全码
const SECURITY_CODE = process.env.CLIPBOARD_SECURITY_CODE || '';

// 接口basic验证：管理/受保护路由统一走 fail-closed 鉴权。
// 保留原有 /config/* 公开路径豁免，避免影响配置读取契约。
export const validateBasicAuth = (request, reply, done) => {
    if (isPublicConfigRequest(request.url)) {
        done();
        return;
    }
    validateAdminAuth(request, reply, done);
};

// 接口密码验证
export const validatePwd = async (request, reply) => {
    const apiPwd = process.env.API_PWD;
    if (!apiPwd) {
        return; // 如果未配置 API_PWD，直接通过
    }
    if (request.url.startsWith('/config/')) {
        let cf_path = request.url.slice(8).split('?')[0];
        // _log.info(cf_path);
        if (['index.js', 'index.js.md5', 'index.config.js', 'index.config.js.md5'].includes(cf_path)) {
            _log.info(`[validatePwd] 猫配置文件 ${cf_path} 跳过接口密码鉴权`);
            return
        }
    }

    // 从查询参数或请求体中获取 pwd
    const pwd = request.query.pwd || request.body?.pwd;

    // 如果 pwd 不存在或与 API_PWD 不匹配，返回 403
    if (pwd !== apiPwd) {
        return reply.code(403).send({error: 'Forbidden: Invalid or missing pwd'});
    }
};


// JS文件验证
export const validateJs = async (request, reply, dr2Dir) => {
    if (request.url.startsWith('/js/')) {
        try {
            let fileName;
            try {
                fileName = decodeURIComponent(request.url.replace('/js/', '').split('?')[0]);
            } catch {
                return reply.code(400).send('Invalid path encoding');
            }
            // 获取文件系统路径，拒绝绝对路径、穿越段和符号链接逃逸
            const filePath = resolveInside(dr2Dir, fileName);

            // 读取文件内容
            let content = await readFile(filePath, 'utf8');
            if (/var rule|function|let |var |const|class Rule|async|this\./.test(content)) {
                // 添加版权信息
                const copyright = `/*!
 * Copyright © ${new Date().getFullYear()} Taoist
 * Licensed under LGPL3 (https://github.com/hjdhnx/drpy-node/blob/main/LICENSE)
 */
`;
                content = `${copyright}${content}`;
            } else {
                content = await fileHeaderManager.removeHeader(content, {
                    mode: 'top-comments',
                    fileType: '.js'
                });
            }

            // 设置响应头并发送修改后的内容
            return reply
                .header('Content-Type', 'application/javascript; charset=utf-8')
                .send(content);

        } catch (error) {
            // 路径校验失败按 403 拒绝，避免继续落到静态文件处理
            if (error instanceof PathSecurityError) {
                return reply.code(403).send('Forbidden');
            }

            // 文件不存在时继续后续处理（由fastify-static处理404）
            if (error.code === 'ENOENT') return;

            // 其他错误处理
            _log.error(`File processing error: ${error.message}`);
            return reply.code(500).send('Internal Server Error');
        }
    }
}

export const validatHtml = async (request, reply, rootDir) => {
    if (request.url.endsWith('index.html')) {
        try {
            const filePath = path.join(rootDir, request.url);
            // _log.info('filePath', filePath);
            // 读取文件内容
            let content = await readFile(filePath, 'utf8');
            content = content.replaceAll('$SECURITY_CODE', SECURITY_CODE);
            // 设置响应头并发送修改后的内容
            return reply
                .header('Content-Type', 'text/html; charset=utf-8')
                .send(content);

        } catch (error) {
            // 文件不存在时继续后续处理（由fastify-static处理404）
            if (error.code === 'ENOENT') return;

            // 其他错误处理
            _log.error(`File processing error: ${error.message}`);
            return reply.code(500).send('Internal Server Error');
        }
    }
}


// Vercel环境检测中间件
export const validateVercel = (request, reply, done) => {
    if (IS_VERCEL) {
        return reply.status(503).send('API not available on Vercel platform');
    }
    done();
};